"""The committed openapi.json is what web/ builds its types from, so it
has to be the document this code actually serves."""
from app.openapi import OPENAPI_PATH, render


def test_the_committed_openapi_document_matches_the_app():
    assert OPENAPI_PATH.read_text() == render(), (
        "app.schemas or a route changed: run `python -m app.openapi` from planning-service/ and commit openapi.json"
    )


def test_every_stream_message_union_is_published():
    document = render()
    for name in ("NavLogMessage", "DetectMessage", "CheckpointNoteMessage"):
        assert f'"{name}"' in document
