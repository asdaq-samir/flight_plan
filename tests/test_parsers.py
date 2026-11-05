"""The engine's readers of the products as sent (wingtip_engine::metar,
taf, notam; winds and tfr are the planner's own now, in test_weather and
test_tfr): real reports from 2026-11-02, read as the AWC decodes them where
the AWC is right, and where it is not, as the report says. The full
comparison over every current report -- 5,227 METARs, 2,997 TAFs, 21,553
NOTAMs -- and where the two differ is in the commit that brought these."""
import json

import wingtip_native

NEAR = 1793628000  # 2026-11-02 14:00Z


def metar(raw):
    return json.loads(wingtip_native.metar_json(raw))


def test_a_us_metar_with_its_tenths():
    m = metar("METAR KDLH 021355Z 27015G25KT 1 1/2SM -RA BR BKN008 OVC015 M02/M04 A2992 RMK AO2 T10171039")
    assert (m["wind_dir_true_deg"], m["wind_speed_kt"], m["wind_gust_kt"]) == (270, 15, 25)
    assert (m["visibility_sm"], m["ceiling_ft"], m["wx"]) == (1.5, 800, "-RA BR")
    assert (m["temp_c"], m["dewpoint_c"], m["altimeter_in_hg"], m["flight_category"]) == (-1.7, -3.9, 29.92, "IFR")


def test_where_the_awc_is_wrong_the_report_is_kept():
    # Fog at the surface: a ceiling of 0 ft (14 CFR 1.1), where the AWC gives none.
    assert metar("SPECI KRCA 011350Z AUTO 27003KT 1/8SM FG BKN000 06/06 A2995 RMK AO2")["ceiling_ft"] == 0
    # The inches group where there is one, not the hectopascals turned to inches.
    assert metar("METAR MSLP 021400Z 06006KT CAVOK 30/21 Q1011 A2988 NOSIG")["altimeter_in_hg"] == 29.88
    # Hectopascals rounded to the hundredth, where the AWC cuts them off.
    assert metar("METAR NCNS 021400Z 13006KT 9999 FEW020 27/26 Q1010")["altimeter_in_hg"] == 29.83


def test_no_category_without_the_sky_and_the_visibility():
    assert metar("METAR KEKQ 021356Z AUTO 12004KT OVC045 14/12 A3032 RMK AO2")["flight_category"] is None


def test_a_taf_s_becmg_lasts_and_keeps_what_it_does_not_change():
    raw = "TAF VAJL 021400Z 0215/0224 09006KT 3000 BR HZ SCT020 SCT100 TEMPO 0215/0218 2000 -RA SHRA BECMG 0221/0223 VRB03KT 2000 BR"
    t = json.loads(wingtip_native.taf_json(raw, NEAR))
    first, tempo, becmg = sorted(t["fcsts"], key=lambda p: (p["timeFrom"], p["change"]))
    assert first["timeTo"] == becmg["timeFrom"]
    assert (becmg["change"], becmg["timeTo"], becmg["wind_dir_true_deg"], becmg["wx"]) == ("BECMG", t["valid_to"], None, "BR")
    assert (tempo["change"], tempo["wx"]) == ("TEMPO", "-RA SHRA")


def test_notams_as_sent():
    (n,) = json.loads(wingtip_native.notam_text_json("!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100EST"))
    assert (n["id"], n["location"], n["starts"], n["ends"], n["estimated"]) == (
        "ORD 10/709", "ORD", "2026-10-19T10:16:00Z", "2026-10-20T11:00:00Z", True)
    # A military NOTAM is named by its own number, which is not unique
    # across fields: the planner's store kept one KEDG's under KAPG's.
    (m,) = json.loads(wingtip_native.notam_text_json("!KEDG M0061/26 EDG RWY 01/19 REDL U/S 2610222101-2701122359"))
    assert (m["id"], m["location"], m["ends"]) == ("M0061/26", "EDG", "2027-01-12T23:59:00Z")
    # A NOTAM in parts: its times are before "END PART".
    (p,) = json.loads(wingtip_native.notam_text_json("!FDC 5/1234 ZZZ PART 2 OF 2 TEXT 2509081619-2709081619EST\nEND PART 2 OF 2"))
    assert p["starts"] == "2025-09-08T16:19:00Z"


def test_nothing_from_what_is_no_report():
    for bad in ["", "METAR", "NOT AVAILABLE", "ééé 021355Z"]:
        assert wingtip_native.metar_json(bad) is None
        assert wingtip_native.notam_text_json(bad) is None
