-- The tables the planner needs to become an application rather than a
-- calculator: who is flying, in what, and the nav log they actually
-- filed.
--
-- routes/checkpoints (V1, V2) stay what they are -- the *scored* output
-- for a corridor, shared by everyone and cached per departure/
-- destination pair. A flight is one pilot's use of that: their aircraft's
-- true airspeed and burn, their cruise altitude, the winds aloft at the
-- hour they are going. Two pilots planning C81 to KDLH share the
-- checkpoints and share nothing else, which is why the nav-log numbers
-- live here and not on `checkpoints`.

CREATE TABLE pilots (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    -- Google's `sub` claim. Stable for the life of the account, where
    -- email is not: a user can change their address, and matching on it
    -- would either lose them their flights or hand them someone else's.
    -- Nullable because a pilot record can exist before a first sign-in.
    google_subject VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE aircraft (
    id BIGSERIAL PRIMARY KEY,
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    tail_number VARCHAR(16) NOT NULL,
    -- ICAO type designator: C172, PA28, BE36.
    type_designator VARCHAR(16) NOT NULL,
    -- The two numbers the dead-reckoning math actually consumes. Held per
    -- aircraft rather than per type because they are properties of the
    -- individual machine and how its owner flies it -- a tired C172 does
    -- not make book numbers.
    cruise_tas_kt DOUBLE PRECISION NOT NULL,
    fuel_burn_gph DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_aircraft_pilot_tail UNIQUE (pilot_id, tail_number)
);

CREATE INDEX idx_aircraft_pilot_id ON aircraft (pilot_id);

CREATE TABLE flights (
    id BIGSERIAL PRIMARY KEY,
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    -- Both nullable, and both ON DELETE SET NULL rather than CASCADE: a
    -- flight that has been flown is a record. Selling the aeroplane, or
    -- re-collecting the corridor it was planned on, must not delete the
    -- history of having flown it.
    aircraft_id BIGINT REFERENCES aircraft (id) ON DELETE SET NULL,
    route_id BIGINT REFERENCES routes (id) ON DELETE SET NULL,
    -- Denormalized from the route on purpose, for the same reason: these
    -- have to survive the route row going away.
    departure_ident VARCHAR(8) NOT NULL,
    destination_ident VARCHAR(8) NOT NULL,
    cruise_altitude_ft INTEGER,
    total_distance_nm DOUBLE PRECISION,
    total_ete_min DOUBLE PRECISION,
    total_fuel_gal DOUBLE PRECISION,
    planned_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_flights_pilot_id ON flights (pilot_id);

CREATE TABLE flight_checkpoints (
    id BIGSERIAL PRIMARY KEY,
    flight_id BIGINT NOT NULL REFERENCES flights (id) ON DELETE CASCADE,
    -- Not `sequence`, which is reserved.
    sequence_no INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    along_track_nm DOUBLE PRECISION NOT NULL,
    -- The leg *leaving* this fix, which is how a nav log is read: you are
    -- at a checkpoint, and these are the numbers to the next one. All
    -- null on the last row, which is the destination and has no leg after
    -- it; groundspeed, ETE and fuel are independently nullable because a
    -- leg whose wind exceeds true airspeed cannot be flown and has no
    -- answer for them.
    leg_distance_nm DOUBLE PRECISION,
    true_course_deg DOUBLE PRECISION,
    magnetic_heading_deg DOUBLE PRECISION,
    groundspeed_kt DOUBLE PRECISION,
    ete_min DOUBLE PRECISION,
    fuel_gal DOUBLE PRECISION,
    -- Deferred to commit, which is not a weakening. Re-planning a flight
    -- replaces its whole nav log, and Hibernate issues the new rows'
    -- inserts before the old rows' deletes within one flush -- so the
    -- transaction passes through a state where sequence 0 legitimately
    -- exists twice. Checked per statement, that is a spurious failure;
    -- checked at commit, the guarantee is the one actually wanted, which
    -- is that no committed flight has two rows at the same position.
    CONSTRAINT uq_flight_checkpoint_sequence UNIQUE (flight_id, sequence_no)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_flight_checkpoints_flight_id ON flight_checkpoints (flight_id);
