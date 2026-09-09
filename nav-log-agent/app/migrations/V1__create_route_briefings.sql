CREATE EXTENSION IF NOT EXISTS vector;

-- VECTOR(384) matches db.EMBEDDING_DIM for the all-MiniLM-L6-v2 model this
-- project embeds with -- fixed here as a historical snapshot, same as any
-- Flyway migration; changing the embedding model later needs a new
-- migration (ALTER COLUMN ... TYPE vector(N)), not editing this file.
CREATE TABLE route_briefings (
    id SERIAL PRIMARY KEY,
    departure_ident TEXT NOT NULL,
    destination_ident TEXT NOT NULL,
    briefing TEXT NOT NULL,
    embedding VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT now()
);
