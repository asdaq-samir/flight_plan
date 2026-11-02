import pytest

from vfr import pack as cycle_pack


@pytest.fixture(autouse=True)
def _no_cycle_pack(tmp_path_factory, monkeypatch):
    """No test reads the cycle pack the planner keeps in data/raw/packs:
    each starts with none, and those that want one write their own."""
    monkeypatch.setattr(cycle_pack, "PACK_DIR", tmp_path_factory.mktemp("packs"))
