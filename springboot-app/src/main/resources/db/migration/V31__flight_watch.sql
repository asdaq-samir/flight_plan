-- A saved flight the pilot asked to be watched up to departure: the app
-- re-briefs it on a schedule (FlightWatchService), asks the planner what
-- changed in words, keeps the latest changes for the app to show and
-- emails the pilot when something did. One a flight, keyed by it; gone
-- with the flight, and with the pilot.
CREATE TABLE flight_watch (
    flight_id BIGINT PRIMARY KEY REFERENCES flights (id) ON DELETE CASCADE,
    -- The flight's pilot again, so whose the watch is costs no join: the
    -- controller reads and ends a watch by flight and pilot together.
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    depart_at TIMESTAMPTZ NOT NULL,
    -- The last briefing kept, as the planner wrote it, for the next one to
    -- be diffed against; never read inside here.
    briefing_json TEXT NOT NULL,
    checked_at TIMESTAMPTZ,
    changed_at TIMESTAMPTZ,
    -- The planner's last answer that said something changed: its
    -- sentences and the reports they came from.
    changes_json TEXT,
    created_at TIMESTAMPTZ NOT NULL
);
-- Each run asks for the watches departing within its window.
CREATE INDEX idx_flight_watch_depart ON flight_watch (depart_at);
