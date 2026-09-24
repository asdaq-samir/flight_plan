"""Long-term memory: past route briefings in pgvector (on the same Postgres
instance `webapp` already uses -- docs/README.md says why that was chosen
over a dedicated vector DB),
embedded with a local sentence-transformer model so no extra API key is
needed just to embed text (Anthropic has no embeddings endpoint).

Schema comes from migrations.py (versioned SQL files in migrations/),
applied once via ensure_schema() at process startup (see mcp_server.py) --
not per-connection anymore.
"""
import os
from urllib.parse import quote_plus

import psycopg
from pgvector.psycopg import register_vector
from sentence_transformers import SentenceTransformer

from . import migrations


def _database_url() -> str:
    """Locally, DATABASE_URL is one plaintext env var (docker-compose.yml).
    On AWS the RDS master password comes from Secrets Manager via ECS's
    `Secrets` mechanism, which injects one raw field value at a time, not a
    composed connection string -- so NavLogAgentTaskDefinition
    (infra/cloudformation/template.yaml) instead passes DB_HOST/DB_NAME/
    DB_USER as plain env vars and DB_PASSWORD as a secret, and the URL is
    built here. quote_plus guards against an RDS-generated password
    containing characters (@, /, %) that would otherwise break URL parsing.
    """
    if password := os.environ.get("DB_PASSWORD"):
        host = os.environ["DB_HOST"]
        port = os.environ.get("DB_PORT", "5432")
        name = os.environ.get("DB_NAME", "vfr_route")
        user = os.environ.get("DB_USER", "vfr")
        return f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{name}"
    return os.environ.get("DATABASE_URL", "postgresql://vfr:vfr@db:5432/vfr_route")


DATABASE_URL = _database_url()
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

_embedder = None


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _embedder


def preload_embedder() -> None:
    """Loads the embedding model at startup so the first request does
    not. The weights are baked into the image (see the Dockerfile) and
    read with HF_HUB_OFFLINE set, so this touches no network."""
    _get_embedder()


def embed(text: str) -> list[float]:
    return _get_embedder().encode(text).tolist()


def ensure_schema() -> None:
    """Run once, at process startup -- applies any migration not yet
    recorded in schema_migrations. Must run before any register_vector()
    call (that needs the `vector` extension/type to already exist).
    """
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    try:
        migrations.apply_all(conn)
    finally:
        conn.close()


def get_connection() -> psycopg.Connection:
    """A fresh pgvector-aware connection -- one per call, not pooled, since
    this agent's request volume doesn't yet warrant a connection pool."""
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    register_vector(conn)
    return conn


def store_briefing(departure_ident: str, destination_ident: str, briefing: str) -> None:
    """Embeds and saves one generated briefing, so retrieve_similar_briefings
    can surface it as precedent for a future similar route."""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO route_briefings (departure_ident, destination_ident, briefing, embedding) "
            "VALUES (%s, %s, %s, %s)",
            (departure_ident, destination_ident, briefing, embed(briefing)),
        )


def retrieve_similar_briefings(query_text: str, limit: int = 3) -> list[dict]:
    """The `limit` briefings whose embedding is closest to query_text's,
    by pgvector's <-> (Euclidean distance) operator."""
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
