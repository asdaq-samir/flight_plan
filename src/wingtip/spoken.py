"""Places said aloud, found as the idents a route is typed in: an ATC
clearance heard by the phone's speech recognizer (the web's
lib/clearance, the app's Clearance) names its points the way a
controller says them, not as they are spelled.

- A navaid by its name: "Gopher" is GEP, "Duluth" DLH (NASR NAV_BASE's
  NAME).
- A fix, an intersection or a GPS waypoint by its five letters said as a
  word: PYKLA as "pickla", BUNYN as "bunyan". The recognizer writes what
  it heard as English, so the match is by sound (`sound`), among the fixes
  near the route only, where a sound-alike is rarely more than one.
- An airport by its name followed by "airport", as AIM 4-4-3 a says a
  clearance limit that is the airport of intended landing is given:
  "cleared to the Duluth airport". Many airports and their navaids share
  a name (AIM 4-4-3 a), so the word says which.
- Anything spelled in the phonetic alphabet arrives as its letters
  already (lib/clearance), and is looked up as an ident.

A SID or a STAR by its name and number -- "Bunyan One departure" is
BUNYN1 at KMSP, "Gopher One arrival" GEP1 -- among the field's own
procedures in the CIFP, its transition among the procedure's own.

What is found is said `sure` only where the words matched an ident or a
name outright; a sound-alike is offered unsure, for the pilot to check
before the route is entered: nothing heard is ever put in a route
unconfirmed (the card's Enter Route).
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

#: The kind a controller says after a point's name (AIM 4-4-3 a: "When
#: the clearance limit is a NAVAID, intersection, or waypoint and the
#: type is known, the clearance should contain type"), and the kind of
#: place each one asks for.
KIND_WORDS = {
    "airport": "airport", "field": "airport", "international": "airport", "regional": "airport", "municipal": "airport",
    "vor": "navaid", "vortac": "navaid", "tacan": "navaid", "dme": "navaid", "ndb": "navaid", "beacon": "navaid",
    "intersection": "fix", "waypoint": "fix", "fix": "fix",
}

#: Words with nothing of the place in them.
FILLER = {"the", "a", "an", "of", "and", "to"}

#: How alike two sounds must be for a sound-alike fix to be offered at all.
ALIKE = 0.75


def sound(word: str) -> str:
    """A word's sound as its consonants: its first letter (any vowel as A),
    then each consonant sound once, the vowels left out -- so "pickla"
    and PYKLA, "bunyan" and BUNYN, "snows" and SNOWZ are one sound."""
    s = re.sub(r"[^A-Z]", "", word.upper())
    if not s:
        return ""
    for spelled, said in (("PH", "F"), ("CK", "K"), ("GH", "G"), ("SCH", "SK"), ("TH", "T"), ("WR", "R"), ("KN", "N"),
                          ("X", "KS"), ("Q", "K"), ("Z", "S"), ("C", "K"), ("DG", "J")):
        s = s.replace(spelled, said)
    first = "A" if s[0] in "AEIOUY" else s[0]
    out = first
    for ch in s[1:]:
        if ch in "AEIOUYHW" or ch == out[-1]:
            continue
        out += ch
    return out


def spelled(word: str) -> str:
    """A word's sound with its vowels kept as one: "pickla" and PYKLA are
    both PAKLA, where PCKLE is PKLA -- the second look between fixes whose
    consonants are the same."""
    s = re.sub(r"[^A-Z]", "", word.upper())
    for spelled_as, said in (("PH", "F"), ("CK", "K"), ("GH", "G"), ("X", "KS"), ("Q", "K"), ("Z", "S"), ("C", "K")):
        s = s.replace(spelled_as, said)
    s = re.sub(r"[AEIOUY]+", "A", s.replace("H", "").replace("W", ""))
    return re.sub(r"(.)\1+", r"\1", s)


def _alike(a: str, b: str) -> float:
    return SequenceMatcher(None, sound(a), sound(b)).ratio()


def _closer(a: str, b: str) -> float:
    return SequenceMatcher(None, spelled(a), spelled(b)).ratio()


def words_of(said: str) -> tuple[list[str], str | None]:
    """The words of a point as said, and the kind its last word asks for:
    "the Gopher VOR" is ["gopher"] and a navaid."""
    words = [w for w in re.findall(r"[a-z0-9']+", said.lower()) if w not in FILLER]
    kind = None
    while words and words[-1] in KIND_WORDS:
        kind = kind or KIND_WORDS[words.pop()]
    return words, kind


def name_words(name: str) -> str:
    """A name as words, its marks gone: "WILKES BARRE" for Wilkes-Barre."""
    return " ".join(re.findall(r"[A-Z0-9']+", name.upper()))


def _row(said: str, place: dict, sure: bool) -> dict:
    return {
        "said": said, "ident": place["ident"], "name": place.get("name"), "kind": place["what"],
        "lat": place.get("lat"), "lon": place.get("lon"), "sure": sure,
    }


def point(said: str, places: list[dict], airport: dict | None = None) -> dict | None:
    """The place `said` names among `places` -- the navaids, fixes and
    airports near the route, each with its `ident`, `name` (a fix has
    none), `what` ("navaid", "fix", "airport"), `lat` and `lon` -- or
    `airport`, the field an airport's name was found as (wingtip.airports'
    search, which the caller asks). None where nothing is near enough."""
    words, kind = words_of(said)
    if not words:
        return None
    joined, spaced = "".join(words).upper(), " ".join(words).upper()
    wanted = [p for p in places if kind is None or p["what"] == kind]
    # A navaid's or a field's ident outright, spelled: "GEP", "KDLH".
    exact = [p for p in wanted if p["ident"].upper() == joined]
    if exact and exact[0]["what"] != "fix":
        return _row(said, exact[0], True)
    if kind == "airport" and airport:
        return _row(said, {**airport, "what": "airport"}, True)
    # A name outright: "Gopher", "Sioux Falls", "Wilkes-Barre" -- before a
    # fix whose letters are the word, which a controller would spell or
    # say as the fix: "Flint" is the Flint VOR (FNT), not the fix FLINT.
    named = [p for p in wanted if p.get("name") and name_words(p["name"]) == spaced]
    if named:
        return _row(said, named[0], True)
    # A fix said as its letters: "PYKLA".
    if exact:
        return _row(said, exact[0], True)
    if airport and kind in (None, "airport") and (airport.get("name") or "").upper().startswith(spaced):
        return _row(said, {**airport, "what": "airport"}, True)
    # A fix by its sound, one word only: five letters said as a word.
    if len(words) != 1:
        return None
    scored = sorted(
        ((max(_alike(joined, p["ident"]), _alike(joined, p.get("name") or "")), _closer(joined, p["ident"]), p)
         for p in wanted if p["what"] != "airport"),
        key=lambda hit: (-hit[0], -hit[1]),
    )
    if not scored or scored[0][0] < ALIKE:
        return None
    return _row(said, scored[0][2], False)


def points(said: str, places: list[dict]) -> list[dict]:
    """The places a run of words names one after another -- "Gopher
    Farmington Pykla", as a recognizer writes a route with no commas --
    the longest names first: "Sioux Falls" is one place, not two. A word
    that names nothing is kept, unfound (`ident` None), for the pilot to
    see what was not understood."""
    words, _ = words_of(said)
    out, i = [], 0
    while i < len(words):
        for j in range(len(words), i, -1):
            found = point(" ".join(words[i:j]), places)
            if found and (found["sure"] or j == i + 1):
                out.append(found)
                i = j
                break
        else:
            out.append({"said": words[i], "ident": None, "name": None, "kind": None, "lat": None, "lon": None, "sure": False})
            i += 1
    return out


def procedure(name: str, number: str, kind: str, listed: list[dict], navaid_names: dict[str, str]) -> dict | None:
    """The SID or STAR said by its name and number -- "Bunyan" "1" --
    among a field's `listed` procedures (wingtip.procedures.procedures_at),
    where `kind` is "departure" or "arrival". A procedure named for its
    navaid is said by the navaid's name ("Gopher One", GEP1):
    `navaid_names` gives them by ident. None where none is like it."""
    best, best_score = None, 0.0
    for p in listed:
        if p["kind"] != kind:
            continue
        m = re.fullmatch(r"([A-Z]+)(\d)", p["id"])
        if not m or m.group(2) != number:
            continue
        letters = m.group(1)
        score = max(_alike(name, letters), _alike(name, navaid_names.get(letters, "")))
        if letters == re.sub(r"[^A-Z]", "", name.upper()) or (navaid_names.get(letters, "").upper() == name.upper()):
            score = 1.0
        if score > best_score:
            best, best_score = p, score
    if best is None or best_score < ALIKE:
        return None
    return {"id": best["id"], "sure": best_score == 1.0, "transitions": best["transitions"]}


def transition(said: str, transitions: list[str], places: list[dict]) -> str | None:
    """The procedure's transition said by its fix's name or sound --
    "Duluth transition" is DLH -- among its own `transitions`."""
    among = [p for p in places if p["ident"] in transitions] + [
        {"ident": t, "what": "fix", "name": None} for t in transitions if not any(p["ident"] == t for p in places)
    ]
    found = point(said, among)
    return found["ident"] if found else None
