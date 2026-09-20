"""Per-checkpoint identification notes: a short, pilot-facing "how to
spot it" sentence, streamed one checkpoint at a time rather than making
the whole nav log wait on N sequential LLM calls. Persisted separately
from chart_picks.csv (that file is ML training data); this is an
operational annotation a pilot edits, not a label."""
import os

import anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from vfr import checkpoint_notes
from vfr import checkpoints as checkpoint_selection

from ..common import DEFAULT_AIRCRAFT, line, ndjson, route_key
from ..schemas import CheckpointNoteSaved, NoteCheckpoint, NoteDone, NoteError, NoteStart
from ..scoring import score

router = APIRouter()

# Same env-var convention as nav-log-agent's NAV_LOG_AGENT_MODEL -- this
# is the only other place in the repo that names a Claude model.
CHECKPOINT_NOTE_MODEL = os.environ.get("CHECKPOINT_NOTE_MODEL", "claude-sonnet-5")
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
    lat: float
    lon: float
    description: str


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
        "details (which shore, which bend) you can't know."
    )
    resp = anthropic.Anthropic().messages.create(
        model=CHECKPOINT_NOTE_MODEL,
        max_tokens=128,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


@router.get("/api/checkpoint-notes")
def describe_checkpoints(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    aircraft: str = DEFAULT_AIRCRAFT,
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
    """
    dep_ident, dest_ident = route_key(dep, dest)
    scored = score(dep_ident, dest_ident)
    selected = checkpoint_selection.select_checkpoints(scored)  # already along-track order
    route = checkpoint_notes.route_key(dep_ident, dest_ident)
    existing = checkpoint_notes.load_notes(route)

    def checkpoint_line(cp: dict, description: str | None, source: str, detail: str | None = None) -> str:
        return line(NoteCheckpoint(
            lat=cp["lat"], lon=cp["lon"], osm_id=cp["osm_id"],
            description=description, source=source, detail=detail,
        ))

    def lines():
        yield line(NoteStart(count=len(selected)))
        global_error: str | None = None
        for i, cp in enumerate(selected):
            saved = checkpoint_notes.find_note(existing, cp["lat"], cp["lon"])
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
                checkpoint_notes.save_note(route, cp["lat"], cp["lon"], description)
            except GLOBAL_ANTHROPIC_ERRORS as err:
                global_error = str(err)
                yield line(NoteError(detail=global_error))
                yield checkpoint_line(cp, None, "error", global_error)
                continue
            except Exception as err:  # noqa: BLE001 -- one bad LLM call must not stop the rest
                yield checkpoint_line(cp, None, "error", str(err))
                continue
            yield checkpoint_line(cp, description, "generated")
        yield line(NoteDone())

    return ndjson(lines())


@router.post("/api/checkpoint-notes")
def save_checkpoint_note(note: CheckpointNoteRequest) -> CheckpointNoteSaved:
    """A pilot's own edit to a checkpoint's identification note --
    replaces whatever was saved at that place, generated or not."""
    if not note.description.strip():
        raise HTTPException(422, "description must not be empty")
    dep_ident, dest_ident = route_key(note.departure_ident, note.destination_ident)
    route = checkpoint_notes.route_key(dep_ident, dest_ident)
    saved = checkpoint_notes.save_note(route, note.lat, note.lon, note.description.strip())
    return CheckpointNoteSaved(ok=True, note=saved)
