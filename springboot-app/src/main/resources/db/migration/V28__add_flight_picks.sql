-- What else the pilot picked for the flight, as the planner's address
-- writes it ("pattern=KMSN%3A18&holds=..."): the runways, procedures,
-- crossing altitudes, times on the ground, holds, the Class B avoided and
-- the plan or altitude flown. A flight opened again lost every one of
-- them, and its totals differed from the ones filed (the 20 Oct audit).
-- Nullable: a flight saved before these, or with none, has none.
ALTER TABLE flights ADD COLUMN picks VARCHAR(1000);
