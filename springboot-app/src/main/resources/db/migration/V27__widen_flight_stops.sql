-- A stop may be the pilot's own point off a fix, written as a flight plan
-- writes one ("VPBNG/090/30.5", up to 14 characters): eight of them and
-- their commas are 119, past the 80 the column held for idents of five.
ALTER TABLE flights ALTER COLUMN stop_idents TYPE VARCHAR(160);
