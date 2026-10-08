-- A flight may start at a present position, as Fly Here's Direct-To does
-- in the air: "@42.2340,-87.9877", flown from rather than taken off from
-- (the planner's app.common.position_of). Eight characters held an
-- airport's ident; the longest position the planner takes is 23.
ALTER TABLE flights ALTER COLUMN departure_ident TYPE VARCHAR(24);
