"""/api/overlay-tiles and /api/overlay-tiles/{name}.pmtiles: the map's
overlay tiles as wingtip.vector_tiles keeps them, read by a map in byte
ranges (a PMTiles archive's header, then its directories, then a tile at a
time), and kept by the browser and the CDN for their cycle."""
import json

from fastapi.testclient import TestClient
from wingtip import vector_tiles

from app.main import app

client = TestClient(app)

NAME = "2026-10-29-v1-0badf00d"
INDEX = {"cycle": "2026-10-29", "name": NAME, "version": 1, "bytes": 256, "built_at": 1.0, "min_zoom": 4,
         "max_zoom": 12, "tolerance_m": 4.1,
         "layers": [{"name": name, "features": 1} for name in vector_tiles.LAYERS]}
DATA = bytes(range(256))


def _held(tmp_path, monkeypatch):
    monkeypatch.setattr(vector_tiles, "TILES_DIR", tmp_path)
    (tmp_path / f"{NAME}.pmtiles").write_bytes(DATA)
    (tmp_path / vector_tiles.INDEX).write_text(json.dumps(INDEX))


def test_none_built_yet_is_a_404(tmp_path, monkeypatch):
    monkeypatch.setattr(vector_tiles, "TILES_DIR", tmp_path)
    assert client.get("/api/overlay-tiles").status_code == 404
    assert client.get(f"/api/overlay-tiles/{NAME}.pmtiles").status_code == 404


def test_the_index_names_the_archive_for_the_hour(tmp_path, monkeypatch):
    _held(tmp_path, monkeypatch)
    listed = client.get("/api/overlay-tiles")
    assert listed.status_code == 200
    assert listed.json() == INDEX
    assert listed.headers["cache-control"] == "public, max-age=300, s-maxage=3600"


def test_the_archive_whole_and_in_byte_ranges(tmp_path, monkeypatch):
    _held(tmp_path, monkeypatch)
    url = f"/api/overlay-tiles/{NAME}.pmtiles"
    whole = client.get(url)
    assert whole.status_code == 200 and whole.content == DATA
    assert whole.headers["accept-ranges"] == "bytes"
    assert whole.headers["cache-control"] == f"public, max-age={28 * 24 * 3600}, immutable"
    assert whole.headers["content-type"] == "application/octet-stream"

    # PMTiles' first read: the 127-byte header and the root directory after
    # it, in one range from 0 (protomaps' FetchSource asks 16,384 bytes).
    head = client.get(url, headers={"Range": "bytes=0-126"})
    assert head.status_code == 206 and head.content == DATA[:127]
    assert head.headers["content-range"] == "bytes 0-126/256"
    assert head.headers["content-length"] == "127"
    # A tile in the middle, and a range past the end cut to the file.
    tile = client.get(url, headers={"Range": "bytes=200-209"})
    assert tile.status_code == 206 and tile.content == DATA[200:210]
    assert client.get(url, headers={"Range": "bytes=250-16383"}).content == DATA[250:]
    assert client.get(url, headers={"Range": "bytes=-6"}).content == DATA[-6:]
    assert client.get(url, headers={"Range": "bytes=300-400"}).status_code == 416


def test_only_an_archives_name_is_served(tmp_path, monkeypatch):
    _held(tmp_path, monkeypatch)
    (tmp_path / "secret.pmtiles").write_bytes(b"x")
    assert client.get("/api/overlay-tiles/secret.pmtiles").status_code == 404
    assert client.get("/api/overlay-tiles/2026-10-29-v1-0badf00e.pmtiles").status_code == 404
    assert client.get("/api/overlay-tiles/..%2F..%2Fpacks%2Fx.pmtiles").status_code == 404
