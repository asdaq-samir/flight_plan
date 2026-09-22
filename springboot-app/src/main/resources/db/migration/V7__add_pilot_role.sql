-- What a signed-in person is allowed to see.
--
-- The app has two faces behind one address: the pilot's planner and the
-- developer's training workspace, switched by a toggle in the header.
-- The toggle was shown to everyone, which is fine while this project
-- has one user and wrong the moment it has two -- a pilot has no
-- business retraining a model.
--
-- Stored as text rather than an integer or a Postgres enum: it is read
-- far more often than it is written, a text value is legible in a
-- backup and in a slow query log, and adding a third role later is an
-- INSERT of a row somewhere rather than an ALTER TYPE.
--
-- Every existing pilot becomes PILOT, which is the safe direction: a
-- developer is granted deliberately, with an UPDATE, rather than
-- inherited by anyone who happened to sign in before this ran.
ALTER TABLE pilots ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'PILOT';

ALTER TABLE pilots ADD CONSTRAINT pilots_role_known CHECK (role IN ('PILOT', 'DEVELOPER'));
