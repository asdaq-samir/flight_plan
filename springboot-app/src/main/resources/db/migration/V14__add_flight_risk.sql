-- The pilot's risk assessment for the flight (the planner's FRAT), as it
-- stood when the flight was saved: its points, where they put it (low,
-- caution or high) and what raised them, one per line. Nullable: a
-- flight saved before the FRAT, or without one, has none.
ALTER TABLE flights ADD COLUMN risk_score INTEGER;
ALTER TABLE flights ADD COLUMN risk_level VARCHAR(8);
ALTER TABLE flights ADD COLUMN risk_factors VARCHAR(2000);
ALTER TABLE flights ADD CONSTRAINT flights_risk CHECK (
    (risk_score IS NULL AND risk_level IS NULL)
    OR (risk_score >= 0 AND risk_level IN ('low', 'caution', 'high')));
