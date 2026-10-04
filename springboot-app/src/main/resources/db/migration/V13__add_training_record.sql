-- What a student's 14 CFR 61.109 experience is reckoned from, beside
-- the logbook's own columns (V12): the hours with an instructor (dual
-- received), alone (solo) and by reference to instruments (simulated,
-- under a view limiter), the full-stop landings at an airport with an
-- operating control tower, and the flight's total distance and longest
-- leg in nautical miles -- what the long solo cross-country and the
-- night cross-country are measured by.
ALTER TABLE logbook_entries ADD COLUMN dual_hours DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN solo_hours DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN instrument_hours DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN towered_landings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN distance_nm DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN longest_leg_nm DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD CONSTRAINT logbook_entries_training CHECK (
    dual_hours >= 0 AND solo_hours >= 0 AND instrument_hours >= 0 AND towered_landings >= 0
    AND distance_nm >= 0 AND longest_leg_nm >= 0);

-- The ACS codes on the pilot's Airman Knowledge Test Report: the areas
-- the examiner must go over again at the practical test (61.39(a)(6)(iii)).
ALTER TABLE pilots ADD COLUMN knowledge_test_codes VARCHAR(2000);

-- The endorsements the pilot's instructor has given them, by the
-- page's own code for each (an AC 61-65 endorsement and its 14 CFR
-- section), and the day it was given. One of each: a new one replaces
-- the old (each 90 days' solo, say).
CREATE TABLE pilot_endorsements (
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    endorsed_on DATE NOT NULL,
    PRIMARY KEY (pilot_id, code)
);
