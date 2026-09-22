package com.northflyers.vfr.security;

/**
 * Whether this deployment offers any way to sign in at all.
 *
 * <p>Two answers depend on it and used to work it out separately.
 * {@link SecurityConfig} decides whether writing through the planner
 * needs a session -- where nobody can sign in, demanding one would lock
 * the app rather than protect it. And the front end decides whether to
 * offer the developer's workspace to a caller with no session, for the
 * same reason: a role cannot be checked where no role can be held.
 *
 * <p>A session comes from OIDC, which needs a real Google or Apple
 * registration, or from the emailed one-time link, which only ever
 * sends when a mail host is configured. Locally neither is, which is
 * the case worth getting right.
 *
 * <p>A plain value rather than a component, published as a bean by
 * {@link SecurityConfig}: a {@code @WebMvcTest} slice pulls in the
 * security configuration but not arbitrary components, so a component
 * here would break every controller slice test in the suite.
 *
 * @param oauthConfigured at least one of Google or Apple has real credentials
 * @param possible any route to a session exists: OIDC, or the magic link
 */
public record SignInOptions(boolean oauthConfigured, boolean possible) {}
