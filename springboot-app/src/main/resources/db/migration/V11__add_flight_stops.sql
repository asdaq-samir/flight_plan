-- The airports a flight lands at on the way, in order, as idents joined
-- by commas ("KMSN,KEAU"): the planner plans each flight between two
-- landings on its own, and a flight opened again plans the same route.
-- Nullable: a flight filed before stops, or flown straight, has none.
ALTER TABLE flights ADD COLUMN stop_idents VARCHAR(80);
