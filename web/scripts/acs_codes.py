"""The ACS's codes, tasks and elements as web/src/lib/acs.json, read from
the FAA's own PDFs of the Private Pilot (FAA-S-ACS-6C) and Instrument
Rating (FAA-S-ACS-8C) Airman Certification Standards -- what a student's
knowledge test report codes are looked up in (the Logbook's Checkride page).

    pip install pypdf
    curl -LO https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf
    curl -LO https://www.faa.gov/training_testing/testing/acs/instrument_rating_airplane_acs_8.pdf
    python web/scripts/acs_codes.py private_airplane_acs_6.pdf instrument_rating_airplane_acs_8.pdf > web/src/lib/acs.json

Run again when the FAA publishes a new edition.
"""
import json
import re
import sys

from pypdf import PdfReader

AREA = re.compile(r"^Area of Operation ([IVX]+)\.\s+(.+?)\s*$")
TASK = re.compile(r"^Task ([A-Z])\.\s+(.+?)\s*$")
ELEMENT = re.compile(r"^((PA|IR)\.([IVX]+)\.([A-Z])\.([KRS]\d+[a-z]?))\s+(.+)$")
# Lines that end an element's text: the next heading, a section's label,
# a page's running header or footer, or its number.
STOP = re.compile(r"^(Area of Operation|Task [A-Z]\.|Knowledge:|Risk\s*$|Management:|Skills:|References:|Objective:|eferences:|bjective:|Note:|"
                  r"Private Pilot for Airplane|Instrument Rating . Airplane|Instrument Rating – Airplane|\d+\s*$|[A-Z]-\d+\s*$)")


def parse(path: str, out: dict) -> str:
    lines = [line.rstrip() for page in PdfReader(path).pages for line in (page.extract_text() or "").splitlines()]
    edition = next(m.group(0) for line in lines for m in [re.search(r"FAA-S-ACS-\d+[A-Z]", line)] if m)
    area_names: dict = {}
    task_names: dict = {}
    current_area = None
    element = None
    for line in lines:
        if "...." in line:  # the table of contents
            continue
        if m := AREA.match(line):
            current_area = m.group(1)
            area_names.setdefault(current_area, m.group(2))
            element = None
            continue
        if (m := TASK.match(line)) and current_area:
            task_names.setdefault((current_area, m.group(1)), re.sub(r"\s+", " ", m.group(2)))
            element = None
            continue
        if m := ELEMENT.match(line):
            code, prefix, area, task, _, text = m.groups()
            text = re.sub(r"^[a-z]\.\s+", "", text)
            out["elements"][code] = text
            out["tasks"].setdefault(f"{prefix}.{area}.{task}", None)
            element = code
            continue
        if element and line and not STOP.match(line) and not ELEMENT.match(line):
            out["elements"][element] += " " + line.strip()
            continue
        element = None
    prefix = "PA" if "ACS-6" in edition else "IR"
    for (area, task), name in task_names.items():
        out["tasks"][f"{prefix}.{area}.{task}"] = {"area": area_names.get(area), "task": name}
    return edition


def main() -> None:
    out = {"editions": [], "tasks": {}, "elements": {}}
    for path in sys.argv[1:]:
        out["editions"].append(parse(path, out))
    out["tasks"] = {code: task for code, task in out["tasks"].items() if task}
    json.dump(out, sys.stdout, indent=0, ensure_ascii=False, sort_keys=True)


if __name__ == "__main__":
    main()
