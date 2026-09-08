"""Long-term memory: past route briefings in pgvector (on the same Postgres
instance `webapp` already uses -- see [[project-git-and-phase-sequencing]]
in project memory for why that was chosen over a dedicated vector DB),
embedded with a local sentence-transformer model so no extra API key is
needed just to embed text (Anthropic has no embeddings endpoint).

Schema is created idempotently on every connection (CREATE EXTENSION/TABLE
IF NOT EXISTS) rather than via a Postgres init script, because the `db`
volume already had real data before pgvector was added here -- an init
script would never have re-run against it.
"""
import os

import psycopg
from pgvector.psycopg import register_vector
from sentence_transformers import SentenceTransformer

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://vfr:vfr@db:5432/vfr_route")
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

_embedder = None


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _embedder


def embed(text: str) -> list[float]:
    return _get_embedder().encode(text).tolist()


def get_connection() -> psycopg.Connection:
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS route_briefings (
            id SERIAL PRIMARY KEY,
            departure_ident TEXT NOT NULL,
            destination_ident TEXT NOT NULL,
            briefing TEXT NOT NULL,
            embedding VECTOR({EMBEDDING_DIM}),
            created_at TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    return conn


def store_briefing(departure_ident: str, destination_ident: str, briefing: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO route_briefings (departure_ident, destination_ident, briefing, embedding) "
            "VALUES (%s, %s, %s, %s)",
            (departure_ident, destination_ident, briefing, embed(briefing)),
        )


def retrieve_similar_briefings(query_text: str, limit: int = 3) -> list[dict]:
    with get_connection() as conn:
        embedding = embed(query_text)
        rows = conn.execute(
            """
            SELECT departure_ident, destination_ident, briefing, embedding <-> %s::vector AS distance
            FROM route_briefings
            ORDER BY embedding <-> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        ).fetchall()
    return [
        {"departure_ident": r[0], "destination_ident": r[1], "briefing": r[2], "distance": float(r[3])}
        for r in rows
    ]
