-- What a flight plan asks for that the app did not keep (FAA Form 7233-4,
-- as AIM Appendix 4 writes each item), so the Brief's form is filled in
-- whole rather than left to the filing service's own profiles.
--
-- The airplane's: item 10a, its navigation, communication and approach
-- equipment and capabilities ("S" for VHF radio, VOR and ILS, or the
-- letters and figures of TBL 4-2: "SDFGRY"); item 10b, its surveillance
-- (TBL 4-3, at most 20 characters: "C", "B1"); and item 19's A/, its
-- colour and markings ("White Yellow Blue"). Nullable: an airplane added
-- before these, or whose owner has not said, shows the items blank.
ALTER TABLE aircraft ADD COLUMN equipment VARCHAR(40);
ALTER TABLE aircraft ADD COLUMN surveillance VARCHAR(20);
ALTER TABLE aircraft ADD COLUMN colour VARCHAR(40);

-- The pilot's: item 19's C/, the pilot in command's name (pilots.full_name,
-- V26) and contact information "including telephone number", valid at the
-- ETA in case search and rescue is needed; and the aircraft home base the
-- domestic form's block 14 asks with them (FAA Form 7233-1). Nullable
-- until the pilot says.
ALTER TABLE pilots ADD COLUMN phone VARCHAR(24);
ALTER TABLE pilots ADD COLUMN home_base VARCHAR(11);
