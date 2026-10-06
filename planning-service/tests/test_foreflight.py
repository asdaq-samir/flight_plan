"""The ForeFlight content pack of a route's checkpoints (app.foreflight):
ForeFlight's waypoint rules, a page named for each waypoint, the course,
and the ZIP its link downloads."""
import io
import json
import re
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import foreflight
from app.main import app

client = TestClient(app)

CHECKPOINTS = "42.372,-88.0928,town,5,2.9,322,4500,2.4~42.9773,-88.6116,water,3.18,45.8~43.1313,-88.7558,road_or_rail,2.62,57,,,"


def _files():
    cps = foreflight.parse_checkpoints(CHECKPOINTS)
    return foreflight.pack_files(["C81", "KDLH"], [[42.32, -88.09], [46.84, -92.19]], cps)


def test_waypoint_names_follow_foreflights_rules_and_name_the_route():
    names = foreflight.waypoint_names("C81", "KDLH", 3)
    assert names == ["C81DLH01", "C81DLH02", "C81DLH03"]
    for name in names:
        # Capitals, one word, at least three characters, a letter among them.
        assert re.fullmatch(r"[A-Z0-9_]{3,}", name) and re.search(r"[A-Z]", name)


def test_each_waypoints_line_fits_what_foreflight_shows():
    cps = foreflight.parse_checkpoints(CHECKPOINTS)
    assert foreflight.description(cps[0]) == "Town, 5.0/5, 3 nm"
    assert all(len(foreflight.description(cp)) <= 30 for cp in cps)


def test_one_folder_a_manifest_the_waypoints_a_page_each_named_for_it_and_the_course():
    files = _files()
    assert sorted(files) == [
        "C81-KDLH-checkpoints/layers/C81-DLH course.kml",
        "C81-KDLH-checkpoints/manifest.json",
        "C81-KDLH-checkpoints/navdata/C81DLH01Checkpoint 1 of 3, Town.txt",
        "C81-KDLH-checkpoints/navdata/C81DLH02Checkpoint 2 of 3, Lake.txt",
        "C81-KDLH-checkpoints/navdata/C81DLH03Checkpoint 3 of 3, Road or railway.txt",
        "C81-KDLH-checkpoints/navdata/Checkpoints.kml",
    ]
    manifest = json.loads(files["C81-KDLH-checkpoints/manifest.json"])
    assert manifest == {
        "name": "Wingtip checkpoints C81-KDLH", "abbreviation": "WT.C81DLH", "version": 1, "organizationName": "Wingtip Maps",
    }
    assert ("<Placemark><name>C81DLH02</name><description>Lake, 3.2/5, 46 nm</description>"
            "<Point><coordinates>-88.611600,42.977300,0</coordinates></Point></Placemark>") in files["C81-KDLH-checkpoints/navdata/Checkpoints.kml"]
    assert "-88.090000,42.320000,0 -92.190000,46.840000,0" in files["C81-KDLH-checkpoints/layers/C81-DLH course.kml"]


def test_a_page_says_what_to_look_for_the_leg_flown_to_it_where_known_and_what_comes_next():
    files = _files()
    first = files["C81-KDLH-checkpoints/navdata/C81DLH01Checkpoint 1 of 3, Town.txt"]
    for words in ("Checkpoint 1 of 3, C81 → KDLH", "the yellow of its built-up area", "5.0 of 5", "322°",
                  "4,500 ft", "0:02", "N42°22.3′ W088°05.6′", "Next: Lake, 42.9 nm on."):
        assert words in first
    last = files["C81-KDLH-checkpoints/navdata/C81DLH03Checkpoint 3 of 3, Road or railway.txt"]
    assert "Magnetic heading" not in last
    assert "The last checkpoint before KDLH." in last


def test_figures_as_a_pilot_writes_them():
    assert foreflight.heading(0) == "360°" and foreflight.heading(5.4) == "005°"
    assert foreflight.elapsed(59.6) == "1:00" and foreflight.elapsed(125) == "2:05"
    assert foreflight.degrees_minutes(-33.9, 151.18) == "S33°54.0′ E151°10.8′"


@pytest.mark.parametrize("bad", ["42,-88,town,5", "95,-88,town,5,1", "42,-88,volcano,5,1", "42,-88,town,five,1"])
def test_a_checkpoint_it_cannot_read_is_refused(bad):
    with pytest.raises(ValueError):
        foreflight.parse_checkpoints(bad)


def _pack_url(cp=CHECKPOINTS):
    return f"/api/foreflight-pack/{foreflight.token('C81', 'KDLH', '', cp)}/C81-KDLH-checkpoints.zip"


def test_the_address_ends_in_the_packs_name_and_carries_the_route_in_a_token():
    # ForeFlight names a download by the end of its address, query and all.
    assert foreflight.read_token(foreflight.token("C81", "KDLH", "KRYV", CHECKPOINTS)) == {
        "dep": "C81", "dest": "KDLH", "stops": "KRYV", "cp": CHECKPOINTS,
    }
    for bad in ("!!!", foreflight.token("", "KDLH", "", "")):
        with pytest.raises(ValueError):
            foreflight.read_token(bad)


def test_the_link_downloads_the_zip_each_folder_an_entry_of_its_own():
    resp = client.get(_pack_url())
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.headers["content-disposition"] == 'attachment; filename="C81-KDLH-checkpoints.zip"'
    names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
    assert names[:3] == ["C81-KDLH-checkpoints/", "C81-KDLH-checkpoints/layers/", "C81-KDLH-checkpoints/navdata/"]
    assert "C81-KDLH-checkpoints/navdata/C81DLH01Checkpoint 1 of 3, Town.txt" in names


def test_a_bad_checkpoint_or_token_in_the_link_is_a_422():
    resp = client.get(_pack_url("42,-88,volcano,5,1"))
    assert resp.status_code == 422
    assert "volcano" in resp.json()["detail"]
    assert client.get("/api/foreflight-pack/!!!/x.zip").status_code == 422


def test_the_same_address_is_the_same_bytes_every_time():
    # ForeFlight asks several times at once; answers that differed (each
    # stamped with when it was made) came together as no pack at all.
    first, second = client.get(_pack_url()), client.get(_pack_url())
    assert first.content == second.content
    assert first.headers["content-length"] == str(len(first.content))
    assert first.headers["accept-ranges"] == "bytes"


def test_a_byte_range_is_a_206_of_just_those_bytes_and_one_past_the_end_a_416():
    whole = client.get(_pack_url()).content
    part = client.get(_pack_url(), headers={"Range": "bytes=10-99"})
    assert part.status_code == 206
    assert part.content == whole[10:100]
    assert part.headers["content-range"] == f"bytes 10-99/{len(whole)}"
    assert client.get(_pack_url(), headers={"Range": "bytes=-20"}).content == whole[-20:]
    assert client.get(_pack_url(), headers={"Range": f"bytes={len(whole)}-"}).status_code == 416
    # A form this does not serve is the whole file.
    assert client.get(_pack_url(), headers={"Range": "bytes=0-1,5-6"}).status_code == 200


def test_its_folders_can_be_opened_and_its_files_read_once_unzipped():
    # A folder stored as 0600 cannot be entered once unzipped: ForeFlight
    # answered such a pack with "Installation Error".
    for info in zipfile.ZipFile(io.BytesIO(client.get(_pack_url()).content)).infolist():
        mode = info.external_attr >> 16
        if info.is_dir():
            assert mode == 0o40755 and info.external_attr & 0x10
        else:
            assert mode == 0o100644
