"""The regulations and the AIM as passages to search and quote from: the
mock oral's sources (vfr.oral), so every answer it gives or checks
stands on the FAA's own words rather than a model's memory of them.

14 CFR Parts 61 and 91 come from the eCFR's API, a section a source
("14 CFR 91.155"), at the title's latest issue; the AIM from the FAA's
HTML edition, a numbered paragraph a source ("AIM 4-1-9"), chapters 3 to
8: airspace, air traffic control, procedures, emergencies, safety and
medical facts. Both are public. Downloaded once into data/raw/references
and kept, refreshed when a month old (the eCFR changes with each rule,
the AIM twice a year), the old copy kept when the FAA cannot be had.

Search is BM25 over each source cut into passages of a few hundred
words: plain word matching, which is what a question about "Class C
two-way communication" needs to find 91.130, and nothing to train or
host.
"""
from __future__ import annotations

import html
import json
import logging
import math
import re
import threading
import time
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import requests

from .config import DATA_DIR
from .faa_data import FAA_HEADERS

log = logging.getLogger(__name__)

CACHE_DIR = DATA_DIR / "raw" / "references"
ECFR = "https://www.ecfr.gov/api/versioner/v1"
AIM = "https://www.faa.gov/air_traffic/publications/atpubs/aim_html"
CFR_PARTS = ("61", "91")
AIM_CHAPTERS = (3, 4, 5, 6, 7, 8)
#: How old a copy is before it is fetched again, seconds.
MAX_AGE_S = 30 * 86400
#: About how long a passage is, characters: a few paragraphs.
PASSAGE_CHARS = 1200


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    text: str
    url: str


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def cfr_sources(xml_text: str, part: str) -> list[Source]:
    """A part of 14 CFR, as the eCFR's XML gives it, a section a source:
    its heading and its paragraphs and tables in words."""
    root = ET.fromstring(xml_text)
    sources = []
    for div in root.iter("DIV8"):
        if div.get("TYPE") != "SECTION":
            continue
        number = div.get("N", "")
        head = div.find("HEAD")
        title = _clean("".join(head.itertext())) if head is not None else number
        body = []
        for child in div:
            if child.tag == "HEAD":
                continue
            if child.tag == "DIV":
                # A table: a row a line, its cells apart.
                for row in child.iter("TR"):
                    body.append(" | ".join(_clean("".join(cell.itertext())) for cell in row))
            else:
                body.append(_clean("".join(child.itertext())))
        text = "\n".join(line for line in body if line)
        if text and "[Reserved]" not in title:
            sources.append(Source(f"14 CFR {number}", title.replace("§ ", "§ "), text,
                                  f"https://www.ecfr.gov/current/title-14/part-{part}/section-{number}"))
    return sources


_TAG = re.compile(r"<[^>]+>")
_PARAGRAPH = re.compile(r'<h4 class="paragraph-title" id="(\d+-\d+-\d+)">(.*?)</h4>', re.S)


def aim_sources(page: str, url: str) -> list[Source]:
    """One section page of the AIM's HTML edition, a numbered paragraph a
    source: its title and its words, lists and notes included."""
    sources = []
    heads = list(_PARAGRAPH.finditer(page))
    for i, match in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(page)
        body = page[match.end():end]
        # Each list item and paragraph its own line, then no markup.
        body = re.sub(r"</(p|li|h\d|tr|aside)>", "\n", body)
        text = "\n".join(line for line in (_clean(_TAG.sub(" ", part)) for part in body.split("\n")) if line)
        number = match.group(1)
        title = _clean(_TAG.sub(" ", match.group(2)))
        if text:
            sources.append(Source(f"AIM {number}", title, text, f"{url}#{number}"))
    return sources


def _fetch_all() -> tuple[list[Source], dict]:
    titles = requests.get(f"{ECFR}/titles.json", timeout=60).json()["titles"]
    issued = next(t for t in titles if t["number"] == 14)["latest_issue_date"]
    sources: list[Source] = []
    for part in CFR_PARTS:
        resp = requests.get(f"{ECFR}/full/{issued}/title-14.xml", params={"part": part}, timeout=180)
        resp.raise_for_status()
        sources += cfr_sources(resp.text, part)
    for chapter in AIM_CHAPTERS:
        for section in range(1, 20):
            url = f"{AIM}/chap{chapter}_section_{section}.html"
            resp = requests.get(url, headers=FAA_HEADERS, timeout=60)
            if resp.status_code == 404:
                break
            resp.raise_for_status()
            sources += aim_sources(resp.text, url)
    return sources, {"cfr_issued": issued, "aim_fetched": time.strftime("%Y-%m-%d"), "fetched_at": time.time()}


_LOCK = threading.Lock()
_LOADED: dict = {}
#: When a refresh last failed, by cache: not tried again for an hour, so
#: an FAA outage is not a minute's wait on every question.
_FAILED: dict = {}
RETRY_S = 3600


def _path(cache_dir) -> Path:
    return Path(cache_dir) / "sources.json"


def sources(cache_dir=CACHE_DIR) -> tuple[list[Source], dict]:
    """Every source and the editions they are from: the kept copy, fetched
    first where there is none and again where it is a month old -- the
    old one kept where the FAA cannot be had."""
    path = _path(cache_dir)
    key = str(path)
    with _LOCK:
        cached = _LOADED.get(key)
        if cached is None and path.exists():
            data = json.loads(path.read_text())
            cached = _LOADED[key] = ([Source(**s) for s in data["sources"]], data["meta"])
        old = cached is None or time.time() - cached[1]["fetched_at"] > MAX_AGE_S
        if old and time.time() - _FAILED.get(key, 0) > RETRY_S:
            try:
                fetched, meta = _fetch_all()
                path.parent.mkdir(parents=True, exist_ok=True)
                part = path.with_suffix(".json.part")
                part.write_text(json.dumps({"meta": meta, "sources": [s.__dict__ for s in fetched]}))
                part.replace(path)
                cached = _LOADED[key] = (fetched, meta)
                _INDEXES.pop(key, None)
            except (requests.RequestException, ET.ParseError, KeyError, StopIteration, ValueError):
                _FAILED[key] = time.time()
                if cached is None:
                    raise
                log.warning("Could not refresh the references; keeping the copy in %s", path, exc_info=True)
        if cached is None:
            raise RuntimeError("The references could not be fetched, and none are kept: try again in an hour.")
        return cached


_WORD = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?")
_STOP = frozenset(
    "a an and are as at be by for from has have in is it its may must no not of on or that the this to under was "
    "which with what when where who will your you any each other than such shall if".split())


def words(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


@dataclass(frozen=True)
class Passage:
    source: Source
    text: str


class Index:
    """BM25 over passages: each source cut at its lines into pieces of
    about PASSAGE_CHARS."""

    K1, B = 1.4, 0.75

    def __init__(self, all_sources: list[Source]):
        self.passages: list[Passage] = []
        for source in all_sources:
            piece = ""
            for line in source.text.split("\n"):
                if piece and len(piece) + len(line) > PASSAGE_CHARS:
                    self.passages.append(Passage(source, piece))
                    piece = ""
                piece = f"{piece}\n{line}" if piece else line
            if piece:
                self.passages.append(Passage(source, piece))
        # The title counts with each of its source's passages.
        self.counts = [Counter(words(f"{p.source.id} {p.source.title} {p.text}")) for p in self.passages]
        self.lengths = [sum(c.values()) for c in self.counts]
        self.mean = sum(self.lengths) / max(1, len(self.lengths))
        df = Counter(w for c in self.counts for w in c)
        n = len(self.passages)
        self.idf = {w: math.log(1 + (n - k + 0.5) / (k + 0.5)) for w, k in df.items()}

    def search(self, query: str, k: int = 8) -> list[Passage]:
        terms = [w for w in set(words(query)) if w in self.idf]
        scored = []
        for i, counts in enumerate(self.counts):
            score = 0.0
            for w in terms:
                tf = counts.get(w)
                if tf:
                    score += self.idf[w] * tf * (self.K1 + 1) / (tf + self.K1 * (1 - self.B + self.B * self.lengths[i] / self.mean))
            if score > 0:
                scored.append((score, i))
        scored.sort(reverse=True)
        return [self.passages[i] for _, i in scored[:k]]


_INDEXES: dict = {}


def index(cache_dir=CACHE_DIR) -> Index:
    all_sources, _ = sources(cache_dir)
    key = str(_path(cache_dir))
    with _LOCK:
        if key not in _INDEXES:
            _INDEXES[key] = Index(all_sources)
        return _INDEXES[key]


def by_id(source_id: str, cache_dir=CACHE_DIR) -> Source | None:
    return next((s for s in sources(cache_dir)[0] if s.id == source_id), None)


def quoted(quote: str, source: Source) -> bool:
    """Whether `quote` is the source's own words: the same words in the
    same order, case, spacing and punctuation aside -- what makes a
    citation one, rather than a model's paraphrase of what it remembers.
    A quote cut with an ellipsis is each of its pieces, in order, every
    one long enough to mean something."""
    have = " ".join(re.findall(r"[a-z0-9]+", source.text.lower()))
    at = 0
    pieces = [piece for piece in re.split(r"\.\.\.|\u2026", quote) if piece.strip()]
    if not pieces:
        return False
    for piece in pieces:
        want = " ".join(re.findall(r"[a-z0-9]+", piece.lower()))
        found = have.find(want, at) if len(want) >= 12 else -1
        if found < 0:
            return False
        at = found + len(want)
    return True
