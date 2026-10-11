package com.northflyers.vfr.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionFixationProtectionStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;

/**
 * Signs a pilot in on this request's session, for the ways in that are
 * not Spring Security's own filters -- the emailed link
 * (MagicLinkController), Sign in with Apple in the iOS app
 * (AppleNativeSignInController) and a TV's code (DeviceSignInController).
 * Each endpoint is its own success handler, so what the filter chain does
 * after a sign-in is done here, once, the same for all three.
 */
public final class SessionSignIn {

    private static final SecurityContextRepository CONTEXTS = new HttpSessionSecurityContextRepository();
    // Spring Security's own session-fixation strategy, run by hand: a
    // session that existed before the sign-in -- one a pilot arrived with,
    // or one someone else planted in their browser -- must not be the one
    // they are signed in on. oauth2Login gets this from
    // AbstractAuthenticationProcessingFilter.
    //
    // A new session, not the old one renamed. Sessions live in Postgres
    // (spring-session-jdbc), and a request still running on the old
    // session when this one signs in -- the planner's nav log stream,
    // left open in the tab the pilot asked for the link from -- saves its
    // copy when it ends, writing the old id back over the renamed row: the
    // new cookie then names no session, and the pilot reads as signed
    // out. A migrated session has a row of its own, so the old request's
    // late save finds nothing to overwrite.
    private static final SessionAuthenticationStrategy NEW_SESSION = new SessionFixationProtectionStrategy();

    private SessionSignIn() {
    }

    public static void signIn(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        NEW_SESSION.onAuthentication(authentication, request, response);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        // Saved explicitly, not only set above: outside the filter chain
        // nothing else persists the context into the session for the next
        // request.
        CONTEXTS.saveContext(context, request, response);
    }
}
