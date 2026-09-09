-- Matches what Hibernate's ddl-auto: update had been auto-creating from
-- Route.java (see that file's Javadoc for why checkpoints is jsonb, not a
-- normalized child table). Flyway owns schema from here on; ddl-auto is
-- validate now, not update -- see application.yml.
CREATE TABLE routes (
    id BIGSERIAL PRIMARY KEY,
    departure_ident VARCHAR(255) NOT NULL,
    destination_ident VARCHAR(255) NOT NULL,
    checkpoints JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
