"""The pilot's assistant (app.assistant): a question about the flight,
answered by the model from the planner's own functions, streamed as
newline-delimited JSON. One billed Claude conversation a question; the
gateway lets signed-in pilots through (SecurityConfig)."""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import assistant
from ..assistant import AssistantAsk

router = APIRouter()


@router.post("/api/assistant", responses={200: {"content": {"application/x-ndjson": {}}}})
def ask_assistant(ask: AssistantAsk) -> StreamingResponse:
    """The answer as events, one JSON object a line: `tool` (name, label)
    as each is asked, `text` (a piece of the answer) as it comes, `sources`
    (id, label, text: the raw things the answer rests on) once, then
    `done`; or `error` with the reason in words. The conversation is sent
    whole each time, the pilot's turn last; the context is the plan,
    position and record as the app has them (AssistantAsk)."""
    # The conversation is checked before the stream opens, so a bad one
    # is a 422 the client reads, not an error event.
    assistant.conversation(ask)
    return StreamingResponse(assistant.answer(ask), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
