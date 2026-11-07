"""The repository's own tests (tests/). The guards every suite shares live in
pytest_guards.py, which each service's conftest.py imports too."""
from pytest_guards import _module_doubles_restored, pytest_collection_modifyitems  # noqa: F401
