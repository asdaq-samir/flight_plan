-- Normalizes routes.checkpoints (a jsonb blob) into its own child table.
-- V1's Checkpoint record carried @JsonProperty snake_case names
-- (osm_id, along_track_nm, predicted_score), so that's the shape the
-- existing jsonb rows are in -- this backfill reads them as such before
-- the column is dropped.
CREATE TABLE checkpoints (
    id BIGSERIAL PRIMARY KEY,
    route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    osm_id VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    along_track_nm DOUBLE PRECISION NOT NULL,
    predicted_score DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_checkpoints_route_id ON checkpoints (route_id);

INSERT INTO checkpoints (route_id, osm_id, category, name, lat, lon, along_track_nm, predicted_score)
SELECT
    r.id,
    cp ->> 'osm_id',
    cp ->> 'category',
    cp ->> 'name',
    (cp ->> 'lat')::DOUBLE PRECISION,
    (cp ->> 'lon')::DOUBLE PRECISION,
    (cp ->> 'along_track_nm')::DOUBLE PRECISION,
    (cp ->> 'predicted_score')::DOUBLE PRECISION
FROM routes r, jsonb_array_elements(r.checkpoints) AS cp;

ALTER TABLE routes DROP COLUMN checkpoints;
