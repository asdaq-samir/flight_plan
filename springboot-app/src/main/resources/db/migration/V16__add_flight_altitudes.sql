-- The altitudes the pilot set at points of the route, as the planner's
-- own `altitudes` parameter writes them ("VPBNG:4500,KDLH:2400"): a
-- waypoint's cruise to it, an airport's pattern. Kept so a flight opened
-- again is planned at them. Nullable: a flight planned at the planner's
-- own altitudes, or saved before these, has none.
ALTER TABLE flights ADD COLUMN own_altitudes VARCHAR(200);
