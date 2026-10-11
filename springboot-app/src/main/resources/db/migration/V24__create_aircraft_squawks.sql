-- An airplane's squawks, as its pilots write them: when, what, whether it
-- is an instrument or equipment that does not work, and for such a one,
-- the kinds of flight the determination of 14 CFR 91.213(d) was made for
-- -- not required (91.205, the equipment list or the kinds of operations
-- list, an AD), removed or deactivated and placarded, no hazard -- VFR by
-- day, VFR by day and night, or every kind; then when it was fixed, and
-- how. Gone with the airplane.
CREATE TABLE aircraft_squawks (
    id BIGSERIAL PRIMARY KEY,
    aircraft_id BIGINT NOT NULL REFERENCES aircraft (id) ON DELETE CASCADE,
    reported_on DATE NOT NULL,
    text VARCHAR(500) NOT NULL,
    inoperative BOOLEAN NOT NULL DEFAULT FALSE,
    deferred_for VARCHAR(16) CHECK (deferred_for IN ('VFR_DAY', 'VFR', 'ALL')),
    fixed_on DATE,
    fix_note VARCHAR(500)
);
CREATE INDEX idx_aircraft_squawks_aircraft ON aircraft_squawks (aircraft_id, fixed_on);
