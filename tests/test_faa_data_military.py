"""The fields the armed services own, and those closed to the public,
from the FAA's airport file (vfr.faa_data.military_fields and
private_fields)."""
from vfr import faa_data

HEADER = "SITE_TYPE_CODE,ARPT_ID,ICAO_ID,ARPT_NAME,OWNERSHIP_TYPE_CODE,FACILITY_USE_CODE,TPA\n"


def test_a_military_field_is_military_unless_open_to_the_public(tmp_path, monkeypatch):
    path = tmp_path / "APT_BASE.csv"
    path.write_text(HEADER + "\n".join([
        "A,MXF,KMXF,MAXWELL AFB,MA,PR,",
        "A,FHU,KFHU,SIERRA VISTA MUNI-LIBBY AAF,MR,PU,",
        "A,NBJ,,BARIN NOLF,MN,PR,",
        "A,DLH,KDLH,DULUTH INTL,PU,PU,",
    ]) + "\n")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: path)
    fields = faa_data.military_fields(tmp_path)
    assert fields == {"MXF": "military", "KMXF": "military", "FHU": "joint", "KFHU": "joint", "NBJ": "military"}


def test_without_the_file_no_field_is_marked(tmp_path, monkeypatch):
    def missing(name, cache_dir):
        raise OSError("no APT_BASE.csv")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", missing)
    assert faa_data.military_fields(tmp_path) == {}


def test_a_field_closed_to_the_public_is_private_unless_the_services_own_it(tmp_path, monkeypatch):
    path = tmp_path / "APT_BASE.csv"
    path.write_text(HEADER + "\n".join([
        "A,IL22,,PRIVATE STRIP,PR,PR,",
        "A,MXF,KMXF,MAXWELL AFB,MA,PR,",
        "A,DLH,KDLH,DULUTH INTL,PU,PU,",
    ]) + "\n")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: path)
    assert faa_data.private_fields(tmp_path) == frozenset({"IL22"})
