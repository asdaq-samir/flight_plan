-- The subscription to the paid features: the work that costs money to
-- run (the written briefing, checkpoint descriptions, the mock oral) or
-- saves real time (the debrief). Planning and flying stay free.
--
-- One row a pilot, made the first time anything is recorded for them:
-- the free month they started (once an account, so the start is kept
-- after it ends), and what they paid for -- until when, on which plan,
-- through which store, and the store's own id for it, which its
-- notifications name. A pilot with no row has never had either.
CREATE TABLE subscriptions (
    pilot_id BIGINT PRIMARY KEY REFERENCES pilots (id) ON DELETE CASCADE,
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    paid_until TIMESTAMPTZ,
    plan VARCHAR(16) CHECK (plan IN ('MONTHLY', 'YEARLY')),
    store VARCHAR(16) CHECK (store IN ('APP_STORE', 'PLAY', 'WEB', 'GRANT')),
    store_ref VARCHAR(200),
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT subscriptions_trial_whole CHECK ((trial_started_at IS NULL) = (trial_ends_at IS NULL))
);

-- A month's uses of each paid feature that calls Claude, per pilot: what
-- the monthly cap is counted against, so a heavy user of the mock oral
-- (Opus, cents a question) cannot cost more than they pay. The month is
-- its first day, UTC.
CREATE TABLE paid_feature_uses (
    pilot_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    month DATE NOT NULL,
    feature VARCHAR(32) NOT NULL,
    uses INTEGER NOT NULL CHECK (uses >= 0),
    PRIMARY KEY (pilot_id, month, feature)
);
