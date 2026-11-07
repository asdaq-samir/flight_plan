"""This service has its own pyproject.toml, so pytest does not look above it
for the repository's conftest.py: take the shared guards (pytest_guards.py,
docs/CI.md, "Flaky tests") from the repository root."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pytest_guards import _module_doubles_restored, pytest_collection_modifyitems  # noqa: E402, F401
