-- The power an aeroplane's cruise TAS and fuel burn are at, in percent.
-- The planner takes the two as its figures at that power at 6,000 ft on
-- a standard day, and flies each leg at what they come to in the leg's
-- own air: the density altitude the forecast temperature gives, and
-- less power where full throttle can no longer make this. Nullable: an
-- aeroplane added before it, or whose owner has not said, is flown at
-- its type's.
ALTER TABLE aircraft ADD COLUMN cruise_power_pct DOUBLE PRECISION;
