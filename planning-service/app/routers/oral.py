"""The mock oral (app.oral): a question about the student's own flight,
and their answer graded, each against the regulations and the AIM.
Two billed Claude calls a question; the developer's until a CFI has
reviewed its answers (the gateway's rules keep it so)."""
from fastapi import APIRouter, HTTPException

from .. import oral
from ..schemas import OralGrade, OralGradeRequest, OralQuestion, OralQuestionRequest

router = APIRouter()


def _unavailable(err: Exception) -> HTTPException:
    return HTTPException(502, f"The mock oral could not reach its examiner: {err}")


@router.post("/api/oral/question", response_model=OralQuestion)
def oral_question(request: OralQuestionRequest) -> OralQuestion:
    """One question on one of the `focus` ACS elements, set in the flight
    `plan` describes, not one of those already `asked`; its answer from
    the sources and the passages it quotes, each checked word for word.
    A 503 where the sources cannot be had, a 502 where the examiner
    cannot be reached."""
    try:
        asked = oral.ask(request.plan, [f.model_dump() for f in request.focus], request.asked)
        editions = oral.editions()
    except oral.OralUnavailable as err:
        raise _unavailable(err) from err
    except RuntimeError as err:
        raise HTTPException(503, str(err)) from err
    return OralQuestion(**asked, editions=editions)


@router.post("/api/oral/grade", response_model=OralGrade)
def oral_grade(request: OralGradeRequest) -> OralGrade:
    """The student's answer graded against the question's answer and the
    sources it was asked from (`source_ids`, as the question gave them)."""
    try:
        graded = oral.grade(request.question, request.model_answer, request.key_points, request.source_ids, request.answer)
    except oral.OralUnavailable as err:
        raise _unavailable(err) from err
    except RuntimeError as err:
        raise HTTPException(503, str(err)) from err
    return OralGrade(**graded)
