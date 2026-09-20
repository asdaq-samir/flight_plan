-- Fuel planning and stepped altitudes.
--
-- An aeroplane's usable fuel, so the nav log can say whether the tanks
-- hold the trip plus the VFR reserve. Nullable: an aeroplane added
-- before this, or one whose owner has not said, gets no fuel check
-- rather than a wrong one.
ALTER TABLE aircraft ADD COLUMN usable_fuel_gal DOUBLE PRECISION;

-- The altitude of the leg arriving at each checkpoint. A plan may step
-- (down under a Class B shelf, up for a tailwind past it), so one
-- cruise altitude on the flight is no longer the whole story. Nullable
-- for flights filed before this.
ALTER TABLE flight_checkpoints ADD COLUMN altitude_ft DOUBLE PRECISION;
