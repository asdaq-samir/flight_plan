"""Per-checkpoint identification notes: a short, pilot-facing "how to
spot it" sentence, streamed one checkpoint at a time rather than making
the whole nav log wait on N sequential LLM calls. Persisted separately
from chart_picks.csv (that file is ML training data); this is an
operational annotation a pilot edits, not a label."""
import os

import anthropic
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from vfr import checkpoint_notes

from vfr import geo

from ..common import line, load_route, ndjson
from ..schemas import CheckpointNoteSaved, NoteCheckpoint, NoteDone, NoteError, NoteStart, PilotNotesForgotten
from ..scoring import route_checkpoints

router = APIRouter()

# Same env-var convention as nav-log-agent's NAV_LOG_AGENT_MODEL. Haiku:
# on eight of the C81 to KDLH route's checkpoints (2026-10-08) it wrote
# lines as useful as claude-sonnet-5's for a quarter of the cost, $0.0002
# a checkpoint against $0.00085.
CHECKPOINT_NOTE_MODEL = os.environ.get("CHECKPOINT_NOTE_MODEL", "claude-haiku-5-5")
# Medium, not low: at low effort the same eight ran to 28 words where the
# prompt asks under 20, and one line ended "Wait, that's not quite right;
# let me give one clean sentence instead." -- in a pilot's nav log. At
# medium, a median of 20 words and nothing of the kind. The model thinks
# first, and the thinking counts toward max_tokens: at 1,024 it ran out
# before the sentence on the nightly AI check's first run (stop reason
# max_tokens), so the cap is 4,096 -- even used whole, $0.002 on Haiku.
CHECKPOINT_NOTE_EFFORT = "medium"
CHECKPOINT_NOTE_MAX_TOKENS = 4096
# These fail the same way for every checkpoint in the route, not just
# the one that happened to hit it first -- a bad key or an exhausted
# rate limit does not get better by trying the next 20 checkpoints the
# same way, it just burns 20 more calls to learn the same thing.
# APITimeoutError is a subclass of APIConnectionError already.
GLOBAL_ANTHROPIC_ERRORS = (
    anthropic.AuthenticationError,
    anthropic.PermissionDeniedError,
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
)


class CheckpointNoteRequest(BaseModel):
    departure_ident: str
    destination_ident: str
    #: The stops landed at on the way, in order (app.common.load_route).
    stops: list[str] = []
    lat: float
    lon: float
    description: str


class GenerateNotesRequest(BaseModel):
    departure_ident: str
    destination_ident: str
    stops: list[str] = []


def _hop_key(hop) -> str:
    """Where a hop's notes are kept: as the route between its two
    landings, so a hop flown on its own, or in another route, reads the
    notes made on it."""
    return checkpoint_notes.route_key(hop.dep_ident, hop.dest_ident)


def _hop_of(r, lat: float, lon: float):
    """The hop of `r` a point is on: the one it lies nearest beside."""
    return min(r.hops, key=lambda hop: abs(geo.cross_track_distance_nm(lat, lon, hop.start, hop.end)))


#: Set by webapp's proxy from the signed-in pilot, and stripped from
#: anything a browser sent (PlannerProxyController). Absent where nobody
#: can sign in, which makes an edit the shared note -- one user, locally.
PILOT_HEADER = "X-Pilot-Id"


def _describe_checkpoint(
    checkpoint: dict, dep_ident: str, prev_name: str | None, next_name: str | None,
) -> str:
    """One Claude call, one checkpoint. The prompt is deliberately
    told not to invent geographic specifics it cannot know: the
    checkpoint data reaching this service is a lat/lon point plus a
    category and an optional OSM name -- no polygon or shoreline
    survives the pipeline this far, so a claim like "the east shore"
    would be a guess dressed as a fact.
    """
    name = checkpoint.get("name") or checkpoint["category"]
    prompt = (
        "In one short sentence (under 20 words), describe exactly where a "
        "VFR pilot should look to positively identify this checkpoint from "
        "the air, so they know they're at the right spot and not somewhere "
        "similar-looking nearby.\n\n"
        f"Checkpoint: {name}, category \"{checkpoint['category']}\".\n"
        f"{checkpoint['along_track_nm']:.1f} nm along the route from {dep_ident}.\n"
        f"Previous checkpoint: {prev_name or 'none (departure)'}\n"
        f"Next checkpoint: {next_name or 'none (destination)'}\n\n"
        "If you don't have specific knowledge of this named feature's "
        "actual shape or layout, say only what's safely inferable from its "
        "category and position -- don't invent specific geographic "
        "details (which shore, which bend) you can't know.\n\n"
        "Reply with that one sentence and nothing else: no preamble, and no "
        "remark about what you do or don't know."
    )
    resp = anthropic.Anthropic().messages.create(
        model=CHECKPOINT_NOTE_MODEL,
        max_tokens=CHECKPOINT_NOTE_MAX_TOKENS,
        output_config={"effort": CHECKPOINT_NOTE_EFFORT},
        messages=[{"role": "user", "content": prompt}],
    )
    # The answer is the text block: a thinking block can come first. A
    # reply cut off at the cap (the thinking shares it) is refused like an
    # empty one, since the note is saved as the one every pilot then sees.
    text = "".join(block.text for block in resp.content if block.type == "text").strip()
    if not text or resp.stop_reason == "max_tokens":
        raise RuntimeError(f"Claude did not finish a note (stop reason {resp.stop_reason})")
    return text


@router.post("/api/checkpoint-notes/generate")
def describe_checkpoints(
    request: GenerateNotesRequest,
    x_pilot_id: str | None = Header(default=None, alias=PILOT_HEADER),
) -> StreamingResponse:
    """One "how to spot it" line per checkpoint, as newline-delimited
    JSON (each line one app.schemas.CheckpointNoteMessage), so a slow
    LLM call on checkpoint 3 does not hold up checkpoints 1 and 2 that
    already arrived.

    Two different kinds of failure, reported two different ways. A
    single checkpoint's own LLM call failing for a reason specific to
    it does not take the rest of the stream down -- every other
    checkpoint is independent and still worth generating, so that one
    gets its own per-checkpoint "error" line and the loop moves on.
    GLOBAL_ANTHROPIC_ERRORS is the opposite case: a bad key or an
    exhausted rate limit fails identically for every checkpoint, so
    it's reported once as a single stream-level "error" (for one
    banner instead of the same text repeated per row) -- but the
    stream itself keeps going: every remaining checkpoint still gets
    its own per-checkpoint "error" line too, just without spending a
    call to learn what's already known. A pilot still gets a row to
    type a note into for every checkpoint, not just the ones that
    happened to come before the failure.

    A POST, not a GET: every checkpoint without a note is a billed
    Claude call and a write, which a GET invited from anything that
    prefetches a link, and which the gateway's rules left public in
    every deployment. The caller's own edit is what they see where they
    made one; generation only ever fills the shared note.
    """
    r = load_route(request.departure_ident, request.destination_ident, request.stops)
    dep_ident = r.dep_ident
    _, selected, _ = route_checkpoints(r)  # already along-track order
    # Notes are matched by place, so the same corridor flown the other
    # way reads the same ones; a route with stops keeps each hop's as
    # that hop's.
    existing = [note for hop in r.hops for note in (
        checkpoint_notes.load_notes(_hop_key(hop))
        + checkpoint_notes.load_notes(checkpoint_notes.route_key(hop.dest_ident, hop.dep_ident)))]

    def checkpoint_line(cp: dict, description: str | None, source: str, detail: str | None = None) -> str:
        return line(NoteCheckpoint(
            lat=cp["lat"], lon=cp["lon"], id=cp["id"],
            description=description, source=source, detail=detail,
        ))

    def lines():
        yield line(NoteStart(count=len(selected)))
        global_error: str | None = None
        for i, cp in enumerate(selected):
            saved = checkpoint_notes.find_note(existing, cp["lat"], cp["lon"], x_pilot_id)
            if saved is not None:
                yield checkpoint_line(cp, saved["description"], "saved")
                continue
            if global_error is not None:
                yield checkpoint_line(cp, None, "error", global_error)
                continue
            try:
                prev = selected[i - 1] if i > 0 else None
                prev_name = (prev["name"] or prev["category"]) if prev else None
                next_cp = selected[i + 1] if i + 1 < len(selected) else None
                next_name = (next_cp["name"] or next_cp["category"]) if next_cp else None
                description = _describe_checkpoint(cp, dep_ident, prev_name, next_name)
                held, written = checkpoint_notes.seed_note(
                    _hop_key(r.hops[cp.get("hop", 0)]), cp["lat"], cp["lon"], description)
            except GLOBAL_ANTHROPIC_ERRORS as err:
                global_error = str(err)
                yield line(NoteError(detail=global_error))
                yield checkpoint_line(cp, None, "error", global_error)
                continue
            except Exception as err:  # noqa: BLE001 -- one bad LLM call must not stop the rest
                yield checkpoint_line(cp, None, "error", str(err))
                continue
            if not written:
                # A shared note saved while this stream ran: it stays.
                yield checkpoint_line(cp, held["description"], "saved")
                continue
            yield checkpoint_line(cp, description, "generated")
        yield line(NoteDone())

    return ndjson(lines(), NoteError)


@router.post("/api/checkpoint-notes")
def save_checkpoint_note(
    note: CheckpointNoteRequest,
    x_pilot_id: str | None = Header(default=None, alias=PILOT_HEADER),
) -> CheckpointNoteSaved:
    """A pilot's own edit to a checkpoint's identification note: what
    they see at that place from now on. Other pilots keep the shared
    note; where nobody can sign in, this becomes the shared note."""
    if not note.description.strip():
        raise HTTPException(422, "description must not be empty")
    r = load_route(note.departure_ident, note.destination_ident, note.stops)
    route = _hop_key(_hop_of(r, note.lat, note.lon))
    saved = checkpoint_notes.save_note(route, note.lat, note.lon, note.description.strip(), x_pilot_id)
    return CheckpointNoteSaved(ok=True, note=saved)


@router.delete("/api/checkpoint-notes/mine")
def forget_pilots_notes(
    x_pilot_id: str | None = Header(default=None, alias=PILOT_HEADER),
) -> PilotNotesForgotten:
    """A pilot's own notes, every one, taken out as their account is
    deleted (the webapp's DELETE /api/me). Asked by the webapp alone:
    its proxy does not forward this path, and the pilot is named by the
    header it sets from the session. The shared notes stay."""
    if not x_pilot_id:
        raise HTTPException(422, f"{PILOT_HEADER} names the pilot whose notes go")
    return PilotNotesForgotten(removed=checkpoint_notes.forget_pilot(x_pilot_id))

