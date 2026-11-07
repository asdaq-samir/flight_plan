import pytest

from wingtip import pack as cycle_pack
from wingtip.config import get_settings


@pytest.fixture(autouse=True)
def _no_cycle_pack(tmp_path_factory, monkeypatch):
    """No test reads the cycle pack the planner keeps in data/raw/packs:
    each starts with none, and those that want one write their own."""
    monkeypatch.setattr(cycle_pack, "PACK_DIR", tmp_path_factory.mktemp("packs"))


@pytest.fixture(autouse=True)
def _settings_from_this_tests_environment():
    """wingtip.config.get_settings() reads the environment once and keeps
    it; a test that sets a variable clears it after (get_settings.cache_clear()),
    and this clears it either side of every test so none sees another's."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
