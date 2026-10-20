"""vfr.notams: the FAA NOTAM System's FNS messages kept, from messages in
the feed's own shape (AIXM 5.1 AIXMBasicMessage, one Event's NOTAM each)."""
import pytest

from vfr import notams

#: 2026-10-20 02:05Z, a few minutes after the messages below.
NOW = 1792461900


def message(*, location, text, start, end, kind="N", series="", number="060", year="2026",
            domestic=None, icao=None, classification="DOM", icao_location=None, lifetime_end=None):
    """One FNS message, shaped as the feed sends them (the samples read
    from the owner's queue on 2026-10-19)."""
    lifetime = (f"<aixm:featureLifetime><gml:TimePeriod><gml:beginPosition>2026-10-19T00:00:00.000Z</gml:beginPosition>"
                f"<gml:endPosition>{lifetime_end}</gml:endPosition></gml:TimePeriod></aixm:featureLifetime>") if lifetime_end else ""
    translations = ""
    if domestic:
        translations += ("<event:translation><event:NOTAMTranslation><event:type>LOCAL_FORMAT</event:type>"
                         f"<event:simpleText>{domestic}</event:simpleText></event:NOTAMTranslation></event:translation>")
    if icao:
        translations += ("<event:translation><event:NOTAMTranslation><event:type>OTHER:ICAO</event:type>"
                         f"<event:formattedText><html:div>&lt;pre&gt;\n{icao}\n&lt;/pre&gt;</html:div></event:formattedText>"
                         "</event:NOTAMTranslation></event:translation>")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><message:AIXMBasicMessage'
        ' xmlns:message="http://www.aixm.aero/schema/5.1/message" xmlns:gml="http://www.opengis.net/gml/3.2"'
        ' xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:event="http://www.aixm.aero/schema/5.1/event"'
        ' xmlns:html="http://www.w3.org/1999/xhtml" xmlns:fnse="http://www.aixm.aero/schema/5.1/extensions/FAA/FNSE">'
        "<message:hasMember><event:Event><event:timeSlice><event:EventTimeSlice>"
        f"<aixm:interpretation>BASELINE</aixm:interpretation>{lifetime}<event:textNOTAM><event:NOTAM>"
        f"{f'<event:series>{series}</event:series>' if series else ''}<event:number>{number}</event:number>"
        f"<event:year>{year}</event:year><event:type>{kind}</event:type><event:issued>2026-10-20T02:02:00.000Z</event:issued>"
        f"<event:location>{location}</event:location><event:effectiveStart>{start}</event:effectiveStart>"
        f"<event:effectiveEnd>{end}</event:effectiveEnd><event:text>{text}</event:text>{translations}"
        "</event:NOTAM></event:textNOTAM><event:extension><fnse:EventExtension>"
        f"<fnse:classification>{classification}</fnse:classification>"
        f"{f'<fnse:icaoLocation>{icao_location}</fnse:icaoLocation>' if icao_location else ''}"
        "</fnse:EventExtension></event:extension></event:EventTimeSlice></event:timeSlice></event:Event>"
        "</message:hasMember></message:AIXMBasicMessage>"
    )


RUNWAY = message(location="ORD", text="RWY 04L/22R CLSD EXC TAX", start="202610191016", end="202610201100",
                 domestic="!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100", icao_location="KORD")


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(notams, "STORE", tmp_path / "notams.sqlite")
    notams.reset()
    yield
    notams.reset()


def test_a_domestic_notam_is_kept_by_its_number_in_the_words_a_briefing_gives():
    assert notams.heard(RUNWAY, now=NOW) == 1
    [kept] = notams.at_fields(["KORD"], now=NOW)
    assert kept["id"] == "ORD 10/709"
    assert kept["raw"] == "!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100"
    assert (kept["starts"], kept["ends"], kept["estimated"]) == ("2026-10-19T10:16:00Z", "2026-10-20T11:00:00Z", False)
    # Asked by the domestic identifier, or for another field: the same, or none.
    assert notams.at_fields(["ORD"], now=NOW) == [kept]
    assert notams.at_fields(["KMDW"], now=NOW) == []
    assert notams.since() == NOW


def test_a_notam_is_let_go_once_it_ends_and_one_estimated_says_so():
    notams.heard(RUNWAY, now=NOW)
    assert notams.at_fields(["KORD"], now=NOW + 9 * 3600) == []
    estimated = message(location="FCM", text="SID KBREW TWO DEPARTURE NA", start="202610201400", end="202610201700EST",
                        classification="FDC", domestic="!FDC 6/0608 FCM SID KBREW TWO DEPARTURE NA")
    notams.heard(estimated, now=NOW)
    [kept] = notams.at_fields(["KFCM"], now=NOW)
    assert (kept["id"], kept["ends"], kept["estimated"]) == ("FDC 6/0608", "2026-10-20T17:00:00Z", True)
    permanent = message(location="FCM", text="TWY A CLSD", start="202610200200", end="PERM",
                        domestic="!FCM 10/001 FCM TWY A CLSD")
    notams.heard(permanent, now=NOW)
    assert [n["id"] for n in notams.at_fields(["KFCM"], now=NOW + 365 * 86400)] == ["FCM 10/001"]


def test_a_domestic_notam_cancelled_early_comes_again_with_its_lifetime_ended():
    tower = dict(location="OWP", text="OBST TOWER LGT (ASR 1307505) U/S", start="202610191840", end="202612031840",
                 domestic="!OKC 10/123 OWP OBST TOWER LGT (ASR 1307505) U/S")
    notams.heard(message(**tower), now=NOW - 3600)
    assert len(notams.at_fields(["OWP"], now=NOW - 60)) == 1
    notams.heard(message(**tower, lifetime_end="2026-10-20T02:03:26.000Z"), now=NOW)
    assert notams.at_fields(["OWP"], now=NOW) == []


def test_an_icao_notam_is_ended_by_the_one_that_cancels_or_replaces_it():
    lights = dict(location="BJC", classification="INTL", icao_location="KBJC", series="A", start="202610200202")
    notams.heard(message(**lights, number="1643", text="SVC PCL ALL U/S EXC LOW INTST ON CONS", end="202610230202",
                         icao="A1643/26 NOTAMN\nQ) KZDV/QLGXX\nA) KBJC\nE) SVC PCL ALL U/S EXC LOW INTST ON CONS"), now=NOW)
    assert [n["id"] for n in notams.at_fields(["KBJC"], now=NOW)] == ["A1643/26"]
    notams.heard(message(**lights, number="1644", kind="C", text="A1644/26 NOTAMC A1643/26\nE) CANCELED",
                         end="202610230202", icao="A1644/26 NOTAMC A1643/26\nE) CANCELED"), now=NOW)
    # Cancelled, and the cancellation is no NOTAM of its own.
    assert notams.at_fields(["KBJC"], now=NOW) == []
    notams.heard(message(**lights, number="1645", text="SVC PCL ALL U/S EXC MEDIUM INTST ON CONS", end="202610201500",
                         icao="A1645/26 NOTAMN\nA) KBJC\nE) SVC PCL ALL U/S EXC MEDIUM INTST ON CONS"), now=NOW)
    notams.heard(message(**lights, number="1646", kind="R", text="SVC PCL ALL U/S", end="202610211500",
                         icao="A1646/26 NOTAMR A1645/26\nA) KBJC\nE) SVC PCL ALL U/S"), now=NOW)
    [kept] = notams.at_fields(["KBJC"], now=NOW)
    assert (kept["id"], kept["raw"]) == ("A1646/26", "A1646/26 NOTAMR A1645/26\nA) KBJC\nE) SVC PCL ALL U/S")


def test_one_notam_sent_in_both_forms_is_given_once_in_the_domestic_words():
    both = dict(location="BJC", text="SVC PCL ALL U/S EXC MEDIUM INTST ON CONS", start="202610200202", end="202610201500")
    notams.heard(message(**both, series="A", number="1645", classification="INTL", icao_location="KBJC",
                         icao="A1645/26 NOTAMN\nA) KBJC\nE) SVC PCL ALL U/S EXC MEDIUM INTST ON CONS"), now=NOW)
    notams.heard(message(**both, domestic="!BJC 10/060 BJC SVC PCL ALL U/S EXC MEDIUM INTST ON CONS 2610200202-2610201500"),
                 now=NOW)
    [kept] = notams.at_fields(["KBJC"], now=NOW)
    assert kept["id"] == "BJC 10/060"


def test_the_worlds_international_notams_are_left_out_and_the_us_ones_kept():
    abroad = message(location="UHHH", text="RWY 05L/23R CLSD", start="202610200200", end="202610270700",
                     series="A", number="7465", classification="INTL", icao_location="UHHH",
                     icao="A7465/26 NOTAMN\nA) UHHH\nE) RWY 05L/23R CLSD")
    assert notams.heard(abroad, now=NOW) == 0
    alaska = message(location="ANC", text="RWY 07L/25R CLSD", start="202610200200", end="202610270700",
                     series="A", number="2001", classification="INTL", icao_location="PANC",
                     icao="A2001/26 NOTAMN\nA) PANC\nE) RWY 07L/25R CLSD")
    assert notams.heard(alaska, now=NOW) == 1
    assert [n["id"] for n in notams.at_fields(["PANC"], now=NOW)] == ["A2001/26"]


def test_anything_but_a_notam_message_keeps_nothing():
    assert notams.heard("<not xml", now=NOW) == 0
    assert notams.heard('<a:AIXMBasicMessage xmlns:a="http://www.aixm.aero/schema/5.1/message"/>', now=NOW) == 0
    assert notams.at_fields([], now=NOW) == []
