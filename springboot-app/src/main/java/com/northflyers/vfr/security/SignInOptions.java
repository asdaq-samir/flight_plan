package com.northflyers.vfr.security;

/**
 * How this deployment is reached: the one answer the access rules and the
 * front end both read.
 *
 * <ul>
 *   <li>{@link Access#SIGN_IN} -- a session can be had (OIDC, or the
 *       emailed link): writes need one, the developer's paths need the
 *       role.
 *   <li>{@link Access#OPEN} -- nobody can sign in, and the deployment says
 *       so out loud ({@code app.open-writes}, the local stack): everything
 *       is open, the developer's workspace included, since no role can be
 *       held to open it with.
 *   <li>{@link Access#CLOSED} -- nobody can sign in and nothing says to
 *       open writes (the default, and AWS's): planning a route is open,
 *       every write and every developer path is refused.
 * </ul>
 *
 * <p>It was two booleans, sign-in possible and open writes, which the
 * rules combined three ways and the page read one of: in CLOSED the page
 * offered the developer's workspace, whose every write was refused, and
 * the stack's status fell through to the public read rule.
 *
 * <p>A plain value rather than a component, published as a bean by
 * {@link SecurityConfig}: a {@code @WebMvcTest} slice pulls in the
 * security configuration but not arbitrary components, so a component
 * here would break every controller slice test in the suite.
 *
 * @param oauthConfigured at least one of Google or Apple has real credentials
 * @param access how this deployment is reached
 */
public record SignInOptions(boolean oauthConfigured, Access access) {

    /** How a deployment is reached; see {@link SignInOptions}. */
    public enum Access { SIGN_IN, OPEN, CLOSED }

    static Access accessFor(boolean signInPossible, boolean openWrites) {
        return signInPossible ? Access.SIGN_IN : openWrites ? Access.OPEN : Access.CLOSED;
    }
}
