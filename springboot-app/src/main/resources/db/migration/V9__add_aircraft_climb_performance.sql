-- The climb's own speed and fuel flow, beside the cruise's. The nav log
-- flies every climb -- from the field, and up again where a plan steps
-- -- and the economical plan weighs what a climb burns against what the
-- winds aloft give back. Nullable: an aeroplane added before these, or
-- whose owner has not said, climbs at the planner's book figures for
-- its type.
ALTER TABLE aircraft ADD COLUMN climb_tas_kt DOUBLE PRECISION;
ALTER TABLE aircraft ADD COLUMN climb_fuel_burn_gph DOUBLE PRECISION;
