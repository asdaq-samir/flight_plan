"""What every Python suite here shares, imported by the conftest.py of each
pytest rootdir: the repository's (tests/), planning-service's,
crewai-agent's and nav-log-agent's. The last three have their own
pyproject.toml, which pytest takes as the rootdir and never looks above, so
neither this repository's settings nor its conftest reach them otherwise.

Tests run in a new random order every time (pytest-randomly), so a test
that leaves the module it tested changed breaks whichever test happens to
run after it. The usual way is a test double put on a module by plain
assignment (`traffic.fetch = fake`) rather than `monkeypatch.setattr`,
which undoes itself: #494 found three in tests/test_traffic.py. The
fixture below fails such a test at its own teardown, by name, instead of
leaving the failure to a stranger on another night's order.
"""
import sys

import pytest

# The code under test: wingtip (src/wingtip) and each service's app
# package. A test module's own globals are its business.
_OURS = ("wingtip", "app")


def _callables() -> dict:
    """Every function, class or other callable our modules hold, by
    (module, name). Only callables: a module keeps caches and lazily
    loaded tables in its other globals on purpose, and a test double is
    nearly always a function or a Mock standing in for one."""
    found = {}
    for name, module in list(sys.modules.items()):
        if module is None or name.split(".")[0] not in _OURS:
            continue
        for attr, value in list(getattr(module, "__dict__", {}).items()):
            if callable(value) and not isinstance(value, type(sys)):
                found[(name, attr)] = value
    return found


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(items):
    """A test marked order_dependent runs after the shuffled rest, in the
    order its file has it: the way out for one whose fix is large, listed
    in its pull request to be fixed. Every other test stays shuffled."""
    held = [item for item in items if item.get_closest_marker("order_dependent")]
    if held:
        items[:] = [item for item in items if not item.get_closest_marker("order_dependent")] + sorted(
            held, key=lambda item: (item.location[0], item.location[1] or 0))


@pytest.fixture(autouse=True)
def _module_doubles_restored():
    # Set up before, and so torn down after, every fixture the test asks
    # for: monkeypatch and mock.patch have put back what they changed by
    # the time this looks.
    before = _callables()
    yield
    left = sorted(f"{module}.{attr}" for (module, attr), value in before.items()
                  if module in sys.modules and getattr(sys.modules[module], attr, value) is not value)
    if left:
        pytest.fail("this test left a module's function replaced: " + ", ".join(left)
                    + ". Use monkeypatch.setattr (or mock.patch), which puts it back, so the next test gets the real one.",
                    pytrace=False)
