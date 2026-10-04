-- The pilot's logbook, and what their currency is reckoned from.
--
-- An entry is a flight flown, in the columns a paper logbook has: the
-- day, the aeroplane (its tail number and type, as text -- an entry
-- outlives the aeroplane's record, as a flight does), the route, the
-- hours (total, at night, cross-country) and the landings by day and at
-- night, which are full-stop landings, the ones 14 CFR 61.57(b) counts.
--
-- The flight review and the medical are dates on the pilot: each one
-- event, not a row per flight.
CREATE TABLE logbook_entries (
    id BIGSERIAL PRIMARY KEY,
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    flown_on DATE NOT NULL,
    aircraft VARCHAR(16),
    aircraft_type VARCHAR(16),
    route VARCHAR(120),
    total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    night_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    cross_country_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    day_landings INTEGER NOT NULL DEFAULT 0,
    night_landings INTEGER NOT NULL DEFAULT 0,
    remarks VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT logbook_entries_counts CHECK (
        total_hours >= 0 AND night_hours >= 0 AND cross_country_hours >= 0 AND day_landings >= 0 AND night_landings >= 0)
);

CREATE INDEX idx_logbook_entries_pilot_flown ON logbook_entries (pilot_id, flown_on DESC);

ALTER TABLE pilots ADD COLUMN flight_review_on DATE;
ALTER TABLE pilots ADD COLUMN medical_expires_on DATE;
