-- Reminders by email, at the pilot's ask, before their currency runs out:
-- the flight review (14 CFR 61.56(c)), the medical (61.23), passengers by
-- day and at night (61.57(a), (b)) and instrument currency (61.57(c)).
-- Off until the pilot turns them on.
ALTER TABLE pilots ADD COLUMN reminders BOOLEAN NOT NULL DEFAULT FALSE;

-- Each reminder sent, once: what it was of, the day it runs out, and how
-- many days before (30, then 7), so a day missed or repeated sends none
-- twice. Gone with the pilot.
CREATE TABLE reminders_sent (
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    what VARCHAR(32) NOT NULL,
    due_on DATE NOT NULL,
    days_before INTEGER NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (pilot_id, what, due_on, days_before)
);
