"""The guards in pytest_guards.py reach every suite, not only tests/: the
planner and the agents have their own pyproject.toml, which pytest takes
as the rootdir without looking above it (docs/CI.md, "Flaky tests")."""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# A test that replaces a function of the app package by plain assignment.
PROBE = '''import sys


def test_leaves_a_module_function_replaced():
    module = next(m for n, m in sorted(sys.modules.items()) if n.startswith("app.") and m is not None
                  and any(callable(v) and not isinstance(v, type) and getattr(v, "__module__", "") == n for v in vars(m).values()))
    name = next(
        k for k, v in vars(module).items()
        if callable(v) and not isinstance(v, type) and getattr(v, "__module__", "") == module.__name__
    )
    setattr(module, name, lambda *a, **k: None)
'''


def _pytest(service: str, *args: str):
    run = subprocess.run([sys.executable, "-m", "pytest", *args], cwd=ROOT / service, capture_output=True, text=True, timeout=300)
    # The root test job installs only the root's requirements; a service's
    # own conftest needs the service's (FastAPI and the rest), which its own
    # CI job installs and checks. Here, without them, there is nothing to ask.
    if "ImportError while loading conftest" in run.stderr:
        pytest.skip(f"{service}'s requirements are not installed in this environment")
    return run


# The services with their own pytest suite, as the tree has them (the agents'
# folders went with #495).
SERVICES = [s for s in ("planning-service", "crewai-agent", "nav-log-agent") if (ROOT / s / "tests").is_dir()]


@pytest.mark.parametrize("service", SERVICES)
def test_a_service_declares_the_marks_of_the_root(service):
    assert "order_dependent" in _pytest(service, "--markers").stdout


@pytest.mark.parametrize("service", ["planning-service"])
def test_a_leaked_module_double_fails_in_a_service(service):
    probe = ROOT / service / "tests" / "test_zz_leak_probe.py"
    probe.write_text(PROBE)
    try:
        run = _pytest(service, str(probe), "-p", "no:randomly")
    finally:
        probe.unlink()
    assert run.returncode != 0 and "left a module's function replaced" in run.stdout + run.stderr
