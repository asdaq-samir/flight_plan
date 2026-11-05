"""/api/cycle-packs and /api/cycle-pack/{cycle}/{region}.pack: the phones'
packs as wingtip.pack keeps them, kept by the phone and the CDN for their
cycle."""
import json

from fastapi.testclient import TestClient
from wingtip import pack as cycle_pack

from app.main import app

client = TestClient(app)

INDEX = {"cycle": "2026-10-29", "built_at": 1.0, "tolerance_deg": 0.0001, "worst_nm": 0.006, "region_deg": 4,
         "regions": [{"name": "n40w088", "west": -88.0, "south": 40.0, "east": -84.0, "north": 44.0,
                      "bytes": 4, "crc32": 7}]}


def test_no_packs_yet_is_a_404(tmp_path, monkeypatch):
    monkeypatch.setattr(cycle_pack, "PACK_DIR", tmp_path)
    assert client.get("/api/cycle-packs").status_code == 404
    assert client.get("/api/cycle-pack/2026-10-29/n40w088.pack").status_code == 404


def test_the_list_and_a_pack_with_how_long_each_is_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(cycle_pack, "PACK_DIR", tmp_path)
    folder = tmp_path / "phone" / "2026-10-29"
    folder.mkdir(parents=True)
    (folder / "index.json").write_text(json.dumps(INDEX))
    (folder / "n40w088.pack").write_bytes(b"WTPK")

    listed = client.get("/api/cycle-packs")
    assert listed.status_code == 200
    assert listed.json() == INDEX
    assert listed.headers["cache-control"] == "public, max-age=300, s-maxage=3600"

    pack = client.get("/api/cycle-pack/2026-10-29/n40w088.pack")
    assert pack.status_code == 200 and pack.content == b"WTPK"
    assert pack.headers["cache-control"] == f"public, max-age={28 * 24 * 3600}, immutable"
    assert pack.headers["content-type"] == "application/octet-stream"

    # Only a cycle's and a region's names: nothing else on the disk.
    assert client.get("/api/cycle-pack/2026-10-29/n44w088.pack").status_code == 404
    assert client.get("/api/cycle-pack/2026-10-29/index.json.pack").status_code == 404
    assert client.get("/api/cycle-pack/..%2F..%2Fpacks/n40w088.pack").status_code == 404
