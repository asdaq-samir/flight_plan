-- What instrument currency is reckoned from (14 CFR 61.57(c)(1)): within
-- the 6 calendar months preceding the month of the flight, six instrument
-- approaches, holding procedures and tasks, and intercepting and tracking
-- courses through the use of navigational electronic systems, in actual
-- or simulated instrument conditions -- logged with each flight: how many
-- approaches, and whether it held and tracked courses.
ALTER TABLE logbook_entries ADD COLUMN approaches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logbook_entries ADD COLUMN holding BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE logbook_entries ADD COLUMN tracking BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE logbook_entries ADD CONSTRAINT logbook_entries_approaches CHECK (approaches >= 0);

-- The day of the pilot's last instrument proficiency check (61.57(d)),
-- as they give it, as they give the flight review's (V12).
ALTER TABLE pilots ADD COLUMN ipc_on DATE;

-- The airplane's last VOR check for IFR (14 CFR 91.171(a)(2)): within
-- the preceding 30 days, its bearing error within 4 degrees at a VOT, a
-- repair station's test signal or a ground checkpoint ((b)(1), (2)), or
-- between dual receivers ((c)), and within 6 at an airborne checkpoint
-- or on an airway's radial in flight ((b)(3), (4)) -- with the date,
-- place and error (d) asks to be recorded.
ALTER TABLE aircraft ADD COLUMN vor_check_on DATE;
ALTER TABLE aircraft ADD COLUMN vor_check_kind VARCHAR(16);
ALTER TABLE aircraft ADD COLUMN vor_check_place VARCHAR(80);
ALTER TABLE aircraft ADD COLUMN vor_check_error_deg DOUBLE PRECISION;
ALTER TABLE aircraft ADD CONSTRAINT aircraft_vor_check_kind
    CHECK (vor_check_kind IN ('VOT', 'REPAIR_STATION', 'GROUND', 'AIRBORNE', 'RADIAL', 'DUAL'));
