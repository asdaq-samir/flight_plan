"""vfr.registry: the FAA's Releasable Aircraft Database read into a lookup
by transponder address and N-number, from a small archive in the FAA's own
shape (its files' header rows, byte-order mark and trailing commas, and
rows as the FAA writes them, 2026-10-09's)."""
import zipfile

import pytest

from vfr import registry

MASTER_HEADER = ("N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,"
                 "ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,"
                 "STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),"
                 "OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR, KIT MODEL,MODE S CODE HEX,")
BLANK = " " * 50


def _master(n, serial, model, engine, year, registrant, name, city, state, cert, cert_code, kind, engine_kind, status,
            airworthy, expires, hex_id, kit=("", "")):
    return ",".join([n, f"{serial:<30}", model, engine, year, registrant, f"{name:<50}", f"{'1 MAIN ST':<33}", " " * 33,
                     f"{city:<18}", state, "606067147 ", "C", "031", "US", "20251017", cert, f"{cert_code:<10}", kind,
                     f"{engine_kind:<2}", f"{status:<2}", "50133730", " ", airworthy, BLANK, BLANK, BLANK, BLANK, BLANK,
                     expires, "01439956", f"{kit[0]:<30}", f"{kit[1]:<20}", f"{hex_id:<10}", ""])


@pytest.fixture
def archive(tmp_path):
    path = tmp_path / "ReleasableAircraft.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("MASTER.txt", "﻿" + "\r\n".join([
            MASTER_HEADER,
            _master("654FL", "28-7125569", "7102802", "41508", "1971", "7", "ROCA ROJA Y CABALLO GRIS DE IDAHO LLC",
                    "MERIDIAN", "ID", "20260112", "1NU", "4", "1", "V", "19711102", "20330131", "A89C1E"),
            _master("14511", "11775", "3930916", "34600", "2024", "3", "UNITED AIRLINES INC", "CHICAGO", "IL", "20240405",
                    "1T", "5", "5", "V", "20240408", "20310430", "A0B7D8"),
            _master("1000W", "CCX-2300-0073", "05639MP", "42714", "2023", "1", "JOE SMITH", "MIDLAND", "TX", "20230302",
                    "42", "4", "1", "13", "20230411", "20260301", "A0001F", kit=("VANS", "RV-7")),
        ]) + "\r\n")
        z.writestr("ACFTREF.txt", "﻿CODE,MFR,MODEL,TYPE-ACFT,TYPE-ENG,AC-CAT,BUILD-CERT-IND,NO-ENG,NO-SEATS,AC-WEIGHT,SPEED,"
                   "TC-DATA-SHEET,TC-DATA-HOLDER,\r\n"
                   "7102802,PIPER                         ,PA-28-140           ,4,1 ,1,0,01,004,CLASS 1,0107,,,\r\n"
                   "3930916,AIRBUS S A S                  ,A321-271NX          ,5,5 ,1,0,02,246,CLASS 3,0000,,,\r\n"
                   "05639MP,VANS                          ,RV-7                ,4,1 ,1,1,01,002,CLASS 1,0000,,,\r\n")
        z.writestr("ENGINE.txt", "﻿CODE,MFR,MODEL,TYPE,HORSEPOWER,THRUST,\r\n"
                   "41508,LYCOMING  ,0-320 SERIES ,1 ,00180,000000,\r\n"
                   "34600,IAE       ,PW1133G-JM   ,5 ,00000,033110,\r\n"
                   "42714,LYCOMING  ,IO-360 SER   ,1 ,00180,000000,\r\n")
    return path


def test_an_airplane_is_found_by_its_address_or_its_n_number(archive, tmp_path):
    assert registry.build(archive, tmp_path / registry.DB_NAME) == 3
    by_hex = registry.lookup(hex_id="a89c1e", directory=tmp_path)
    assert by_hex == registry.lookup(n_number="n654fl", directory=tmp_path)
    assert by_hex["n_number"] == "N654FL"
    # Its owner's name as a name is written, its town, never its street.
    assert (by_hex["owner"], by_hex["owner_type"], by_hex["city"], by_hex["state"]) == (
        "Roca Roja Y Caballo Gris De Idaho LLC", "LLC", "Meridian", "ID")
    assert "street" not in by_hex and "1 MAIN ST" not in str(by_hex)
    assert (by_hex["manufacturer"], by_hex["model"], by_hex["year"], by_hex["seats"]) == ("Piper", "PA-28-140", 1971, 4)
    assert (by_hex["engine"], by_hex["engine_type"], by_hex["horsepower"]) == ("Lycoming 0-320 Series", "Reciprocating", 180)
    assert by_hex["airworthiness"] == "Standard (normal, utility)" and by_hex["airworthiness_date"] == "1971-11-02"
    assert (by_hex["certificate_issued"], by_hex["expires"]) == ("2026-01-12", "2033-01-31")
    assert (by_hex["standing"], by_hex["status"]) == ("valid", "Valid")


def test_a_makers_initials_are_kept_and_a_companys_form_written_as_a_word(archive, tmp_path):
    registry.build(archive, tmp_path / registry.DB_NAME)
    ual = registry.lookup(hex_id="A0B7D8", directory=tmp_path)
    assert (ual["owner"], ual["manufacturer"], ual["engine"], ual["thrust_lb"]) == (
        "United Airlines Inc", "Airbus S A S", "IAE PW1133G-JM", 33110)
    assert ual["airworthiness"] == "Standard (transport)" and ual["engines"] == 2


def test_an_expired_registration_says_so_and_an_amateur_built_its_kit(archive, tmp_path):
    registry.build(archive, tmp_path / registry.DB_NAME)
    rv = registry.lookup(n_number="N1000W", directory=tmp_path)
    assert (rv["standing"], rv["status"]) == ("lapsed", "Registration expired")
    assert rv["airworthiness"] == "Experimental (amateur built)"
    # A person's three letters are a name, not initials.
    assert rv["owner"] == "Joe Smith" and rv["kit"] == "Vans RV-7"


def test_none_where_the_registry_is_not_read_or_has_no_such_airplane(archive, tmp_path):
    assert registry.lookup(hex_id="a89c1e", directory=tmp_path) is None
    registry.build(archive, tmp_path / registry.DB_NAME)
    assert registry.lookup(hex_id="000001", directory=tmp_path) is None
    # Not an N-number: a foreign registration is not looked for.
    assert registry.lookup(n_number="G-EUPT", directory=tmp_path) is None
