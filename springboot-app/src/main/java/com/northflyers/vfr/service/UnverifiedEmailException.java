package com.northflyers.vfr.service;

/** An OIDC sign-in whose provider does not vouch for the email address
 *  it carries, which therefore cannot identify a pilot here. */
public class UnverifiedEmailException extends RuntimeException {

    public UnverifiedEmailException(String email) {
        super("Your sign-in provider has not verified " + email + ", so it cannot sign you in here. "
                + "Verify it with the provider, or sign in with an email link instead.");
    }
}
