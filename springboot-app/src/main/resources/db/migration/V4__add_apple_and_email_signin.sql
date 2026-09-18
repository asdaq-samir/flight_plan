-- Two more ways into the same `pilots` row V3 already created for
-- Google. Apple is a second OIDC identity, so it gets a second nullable
-- subject column of its own -- a Google `sub` and an Apple `sub` for the
-- same person are two unrelated opaque strings, never comparable, so
-- they cannot share one column.
--
-- Email sign-in needs no subject at all: a magic link only ever proves
-- "this address answered," and email is already the pilot's own stable
-- identity column. What it needs instead is somewhere to hold the
-- one-time token between "sent" and "clicked."

ALTER TABLE pilots ADD COLUMN apple_subject VARCHAR(255) UNIQUE;

CREATE TABLE magic_links (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    -- SHA-256 of the token actually emailed, never the token itself --
    -- the same reason a password column holds a hash, not the password.
    -- A row here is otherwise a bearer credential for whatever address
    -- it names.
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    -- Null until the link is clicked; set exactly once, which is what
    -- makes a second click on the same link fail rather than sign in
    -- again on a token someone else's screen (or inbox) still shows.
    consumed_at TIMESTAMPTZ
);
-- No separate index on token_hash: UNIQUE above already creates one,
-- and it's the only column a lookup ever filters on.
