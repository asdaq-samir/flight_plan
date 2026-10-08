-- The refresh token Apple hands the server at each Sign in with Apple
-- (authorization-code flow), kept so that deleting the account can revoke
-- it at Apple's /auth/revoke, which App Review's 5.1.1(v) expects of an
-- app that offers Sign in with Apple. Null for a pilot who never used it.
ALTER TABLE pilots ADD COLUMN apple_refresh_token VARCHAR(2000);
