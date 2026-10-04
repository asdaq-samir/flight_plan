"""Temporary flight restrictions from tfr.faa.gov, without the network:
the shapes and the NOTAMs' details stubbed with the site's own shapes."""
from datetime import datetime, timedelta, timezone

import pytest

from vfr import tfr

# A trimmed copy of the site's detail_6_6654.xml: a fire-fighting TFR,
# its times in UTC, one area from the surface to 10,000 ft MSL.
DETAIL = b"""<XNOTAM-Update><Group><Add><Not>
  <dateEffective>2026-10-01T16:00:00</dateEffective><dateExpire>2026-10-15T02:00:00</dateExpire>
  <codeTimeZone>UTC</codeTimeZone>
  <txtDescrPurpose>TO PROVIDE A SAFE ENVIRONMENT FOR FIRE FIGHTING ACFT OPS</txtDescrPurpose>
  <TfrNot><codeType>91.137(a)(2)</codeType><TFRAreaGroup><aseTFRArea>
    <codeDistVerUpper>ALT</codeDistVerUpper><valDistVerUpper>10000</valDistVerUpper><uomDistVerUpper>FT</uomDistVerUpper>
    <codeDistVerLower>ALT</codeDistVerLower><valDistVerLower>0</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>
  </aseTFRArea></TFRAreaGroup></TfrNot>
</Not></Add></Group></XNOTAM-Update>"""


def test_a_notams_detail_is_its_times_rule_purpose_and_altitudes():
    assert tfr.parse_detail(DETAIL) == {
        "effective": "2026-10-01T16:00:00Z", "expires": "2026-10-15T02:00:00Z",
        "rule": "relief aircraft operations (91.137(a)(2))",
        "purpose": "To provide a safe environment for fire fighting acft ops",
        "floor_ft": 0.0, "floor_ref": "MSL", "ceiling_ft": 10000.0, "ceiling_ref": "MSL",
    }


def test_a_height_above_the_ground_or_a_flight_level_is_said_so():
    agl = DETAIL.replace(b"<codeDistVerUpper>ALT", b"<codeDistVerUpper>HEI").replace(b">10000<", b">400<")
    assert tfr.parse_detail(agl)["ceiling_ref"] == "AGL"
    fl = DETAIL.replace(b">10000<", b">910<").replace(b"<uomDistVerUpper>FT", b"<uomDistVerUpper>FL")
    assert tfr.parse_detail(fl)["ceiling_ft"] == 91000.0


def _square(lat, lon, half=0.05):
    return [[[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]]]


@pytest.fixture
def two_tfrs(monkeypatch):
    """One on a route from (42, -88) north to (43, -88), one 60 nm off it."""
    monkeypatch.setattr(tfr, "_shapes", lambda: [
        {"properties": {"NOTAM_KEY": "6/1-1-FDC-F", "TITLE": "ON IT", "LEGAL": "SECURITY", "LAST_MODIFICATION_DATETIME": "1"},
         "geometry": {"type": "Polygon", "coordinates": _square(42.5, -88.0)}},
        {"properties": {"NOTAM_KEY": "6/2-1-FDC-F", "TITLE": "FAR OFF", "LEGAL": "HAZARDS", "LAST_MODIFICATION_DATETIME": "1"},
         "geometry": {"type": "Polygon", "coordinates": _square(42.5, -86.6)}},
    ])
    monkeypatch.setattr(tfr, "_detail", lambda notam_id, modified: {
        "effective": "2026-10-06T23:00:00Z", "expires": "2026-10-07T01:00:00Z"})


def test_a_tfr_the_route_goes_through_during_the_flight_is_told(two_tfrs):
    start = datetime(2026, 10, 6, 22, 30, tzinfo=timezone.utc)
    found = tfr.along_route([(42.0, -88.0), (43.0, -88.0)], start, start + timedelta(hours=2))
    assert [(t["notam_id"], t["kind"], t["crosses"]) for t in found] == [("6/1", "Security", True)]
    assert found[0]["along_track_nm"] == pytest.approx(30.0, abs=1.0)


def test_a_tfr_over_before_the_flight_is_not(two_tfrs):
    start = datetime(2026, 10, 7, 2, 0, tzinfo=timezone.utc)
    assert tfr.along_route([(42.0, -88.0), (43.0, -88.0)], start, start + timedelta(hours=2)) == []
