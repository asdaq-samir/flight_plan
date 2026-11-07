"""The Brief's narrative (app.narrative): the nav log on screen told in
words by Claude, streamed as newline-delimited JSON. One billed Claude
call a narrative; the gateway lets only a subscribed, signed-in pilot
through, within the month's cap and the day's allowance
(PlannerProxyController)."""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import narrative
from ..narrative import NarrativeRequest

router = APIRouter()


@router.post("/api/briefing/narrative", responses={200: {"content": {"application/x-ndjson": {}}}})
def write_narrative(request: NarrativeRequest) -> StreamingResponse:
    """The narrative as lines of NarrativeMessage: `delta` (a piece of
    the text) as Claude writes it, then `done` with the whole briefing,
    or `error` with why there is none. The body is the nav log the Brief
    shows -- idents, airplane, cruise altitude and its selection, the
    legs -- and is checked before Claude is asked, so a nav log the
    prompt cannot read is a 422 naming the field, not an error line."""
    return StreamingResponse(narrative.stream(request), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
