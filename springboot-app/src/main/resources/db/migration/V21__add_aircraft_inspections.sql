-- The airplane's inspections and tests, as its owner records them from its
-- maintenance records, for whether it may be flown:
--   the annual inspection, within the preceding 12 calendar months (14 CFR
--   91.409(a));
--   the 100-hour inspection for an airplane flown for hire or for
--   instruction it is provided for (91.409(b)): the time in service at the
--   last annual or 100-hour, and the airplane's time in service now;
--   the altimeter and static system test for IFR in controlled airspace,
--   within the preceding 24 calendar months (91.411(a));
--   the transponder test, within the preceding 24 calendar months
--   (91.413(a));
--   the ELT's inspection, within 12 calendar months after the last
--   (91.207(d)), and the date its battery must be replaced by, as marked
--   on the transmitter (91.207(c)).
ALTER TABLE aircraft ADD COLUMN annual_on DATE;
ALTER TABLE aircraft ADD COLUMN hundred_hour_at_hours DOUBLE PRECISION;
ALTER TABLE aircraft ADD COLUMN hours_now DOUBLE PRECISION;
ALTER TABLE aircraft ADD COLUMN static_check_on DATE;
ALTER TABLE aircraft ADD COLUMN transponder_check_on DATE;
ALTER TABLE aircraft ADD COLUMN elt_inspected_on DATE;
ALTER TABLE aircraft ADD COLUMN elt_battery_due_on DATE;
ALTER TABLE aircraft ADD CONSTRAINT aircraft_hours
    CHECK ((hundred_hour_at_hours IS NULL OR hundred_hour_at_hours >= 0) AND (hours_now IS NULL OR hours_now >= 0));
