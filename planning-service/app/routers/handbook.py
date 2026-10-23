"""An airplane's planning figures read off a photo of its handbook's page
(app.handbook), for the pilot to check and save as their N-number's."""
from fastapi import APIRouter, HTTPException

from .. import handbook
from ..schemas import HandbookFigures, HandbookPage

router = APIRouter()

#: A phone's photo, made smaller on the phone before it is sent (the web's
#: AirplaneFigures): a few hundred kilobytes; this is past any it sends.
MAX_BASE64 = 8_000_000


@router.post("/api/handbook/read", response_model=HandbookFigures)
def read_handbook(page: HandbookPage) -> HandbookFigures:
    if len(page.image_base64) > MAX_BASE64:
        raise HTTPException(413, "The photo is too large: take it again, or send a smaller one.")
    try:
        return HandbookFigures.model_validate(handbook.read(page.image_base64, page.media_type))
    except handbook.HandbookUnreadable as err:
        raise HTTPException(502, f"The handbook page could not be read: {err}") from err
