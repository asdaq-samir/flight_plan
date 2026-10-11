-- An airplane's checklist, as its owner writes it from its flight manual:
-- items in order, each in its section (Preflight, Before takeoff, ...), a
-- challenge and its response. Gone with the airplane.
CREATE TABLE aircraft_checklist_items (
    id BIGSERIAL PRIMARY KEY,
    aircraft_id BIGINT NOT NULL REFERENCES aircraft (id) ON DELETE CASCADE,
    -- Not `sequence`, which is reserved.
    sequence_no INTEGER NOT NULL,
    section VARCHAR(40) NOT NULL,
    challenge VARCHAR(80) NOT NULL,
    response VARCHAR(80)
);
CREATE INDEX idx_aircraft_checklist_items_aircraft ON aircraft_checklist_items (aircraft_id, sequence_no);
