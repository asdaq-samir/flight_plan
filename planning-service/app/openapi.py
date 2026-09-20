"""Writes this service's OpenAPI document to planning-service/openapi.json,
the file web/ generates its TypeScript API types from (`npm run types`).
Run it after changing anything in app.schemas or a router's signature:

    python -m app.openapi

tests/test_openapi.py fails until the committed file matches."""
import json
from pathlib import Path

from .main import app

OPENAPI_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OPENAPI_PATH.write_text(render())
    print(f"wrote {OPENAPI_PATH}")
