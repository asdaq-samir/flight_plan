"""The FAA's NASR and obstacle files are fetched again on their own switch
(FAA_DATA_AUTO_REFRESH), not the charts': production draws no charts
(CHARTS_AUTO_REFRESH=0), and gated on that it never fetched a new NASR
cycle -- airports, frequencies, navaids, Class B/C/D -- or obstacle file."""
import pytest
from app import chart_refresh, main
from wingtip.config import Settings


@pytest.fixture
def editions(monkeypatch):
    """The folders refresh_editions was asked about; nothing new found."""
    asked: list = []
    monkeypatch.setattr(main.faa_data, "refresh_editions", lambda folder: asked.append(folder) or [])
    return asked


def test_the_editions_are_checked_with_the_charts_off_and_the_switch_on(monkeypatch, editions):
    monkeypatch.setattr(chart_refresh, "AUTO_REFRESH", False)
    monkeypatch.setattr(main, "FAA_DATA_AUTO_REFRESH", True)
    checked = main.check_faa_editions(0.0)
    assert editions == [main.altitude.DEFAULT_FAA_CACHE_DIR]
    assert checked > 0
    # And not again until EDITIONS_CHECK_EVERY_S has passed.
    assert main.check_faa_editions(checked) == checked
    assert len(editions) == 1


def test_the_switch_off_checks_nothing(monkeypatch, editions):
    monkeypatch.setattr(chart_refresh, "AUTO_REFRESH", True)
    monkeypatch.setattr(main, "FAA_DATA_AUTO_REFRESH", False)
    assert main.check_faa_editions(0.0) == 0.0
    assert editions == []


def test_the_switch_is_on_unless_set_off(monkeypatch):
    monkeypatch.delenv("FAA_DATA_AUTO_REFRESH", raising=False)
    monkeypatch.setenv("CHARTS_AUTO_REFRESH", "0")
    assert Settings().faa_data_auto_refresh is True
    monkeypatch.setenv("FAA_DATA_AUTO_REFRESH", "0")
    assert Settings().faa_data_auto_refresh is False
