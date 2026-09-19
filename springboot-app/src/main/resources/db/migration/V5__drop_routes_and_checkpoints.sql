-- routes/checkpoints (V1, V2) were webapp's own copy of a scored
-- corridor, written by a POST /api/routes that called model-service
-- directly. planning-service has owned scoring since the React front end
-- arrived and nothing called that endpoint any more, so the tables go --
-- and with them flights.route_id, which was always null because no
-- route row was ever created.
ALTER TABLE flights DROP COLUMN route_id;
DROP TABLE checkpoints;
DROP TABLE routes;
