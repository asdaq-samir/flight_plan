-- A flight's flown track, where the pilot saved it to their account for
-- its debrief (a track is kept on their device unless they do): the
-- file it came from, and its points as JSON -- [{t, lat, lon, altFt}],
-- thinned to a few thousand -- read back whole, never queried inside.
-- One a flight; gone with the flight.
CREATE TABLE flight_tracks (
    flight_id BIGINT PRIMARY KEY REFERENCES flights (id) ON DELETE CASCADE,
    source VARCHAR(120) NOT NULL,
    points TEXT NOT NULL,
    point_count INTEGER NOT NULL CHECK (point_count >= 2),
    saved_at TIMESTAMP WITH TIME ZONE NOT NULL
);
