package com.northflyers.vfr.security;

import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;

/**
 * Who may call what.
 *
 * <p>Two kinds of resource, split on whether the answer depends on who is
 * asking. A planned route is the same for everyone who plans that corridor
 * and stays public. A pilot's aeroplanes and filed flights are theirs,
 * and require a session. Writes through the planner (picks, checkpoint
 * notes, corridor builds) sit in between: open where nobody can sign in,
 * a session's job as soon as somebody can.
 *
 * <p>Sign-in is Google, Apple, or a magic link, and the session is the
 * servlet container's -- there is no token minting, refreshing or
 * revocation of our own here, which is the point of choosing OIDC (and,
 * for email, a one-time link rather than a password) over rolling it.
 * {@code oauth2Login} is registered only when {@link OAuthClientsConfig}
 * actually produced a {@link ClientRegistrationRepository} -- i.e. at
 * least one of Google/Apple has real credentials -- and the failure mode
 * when neither does is that protected endpoints return 401 with no OIDC
 * way to log in (the magic-link endpoints below are separate from this
 * and work independently). That is deliberate: an unconfigured
 * deployment should refuse callers, not admit them.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final boolean oauthConfigured;
    private final boolean signInPossible;
    private final String chartTilesOrigin;
    // HSTS is right behind a TLS-terminating load balancer and wrong on
    // the local HTTPS port (HttpsConnectorConfig): a browser that once
    // opened https://localhost:8443 would remember to upgrade every
    // http://localhost:8080 after it, and the plain port is the one
    // everything on this machine uses. Off locally (docker-compose.yml),
    // on by default.
    private final boolean hsts;

    private final SignInOptions signIn;

    SecurityConfig(Optional<ClientRegistrationRepository> clientRegistrations,
                   @Value("${spring.mail.host:}") String mailHost,
                   @Value("${app.chart-tiles-origin:}") String chartTilesOrigin,
                   @Value("${app.hsts:true}") boolean hsts) {
        this.hsts = hsts;
        // A session can be obtained through OIDC, or through the magic
        // link -- which only ever sends when a mail host is configured.
        this.oauthConfigured = clientRegistrations.isPresent();
        this.signInPossible = oauthConfigured || !mailHost.isBlank();
        this.signIn = new SignInOptions(oauthConfigured, signInPossible);
        // The CDN the chart tiles come from on AWS (application.yml's
        // app.chart-tiles-origin), which img-src must allow; blank
        // locally, where the tiles are same-origin.
        this.chartTilesOrigin = chartTilesOrigin.isBlank() ? "" : " " + chartTilesOrigin.trim();
    }

    /** Published so SignInCapabilitiesController can answer the same
     *  question this class asks, without working it out a second time.
     *  A @WebMvcTest slice includes this configuration, so the bean
     *  comes with it. */
    @Bean
    SignInOptions signInOptions() {
        return signIn;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(auth -> {
                    auth
                            // Health and docs: an orchestrator and a reader,
                            // neither of which can hold a session.
                            .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                            .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                            // The front end itself, and reading from the
                            // planner: planning a route needs no account.
                            .requestMatchers("/app", "/app/**").permitAll()
                            .requestMatchers(HttpMethod.GET, "/api/planner/**").permitAll();
                    // Writing through the planner -- saving a pick or a
                    // checkpoint note, starting a corridor build (minutes
                    // of Overpass and FAA I/O per call) -- needs a session
                    // as soon as this deployment offers any way to get
                    // one. Locally nothing does, so the Label page keeps
                    // working signed out.
                    if (signInPossible) {
                        auth.requestMatchers("/api/planner/**").authenticated();
                    } else {
                        auth.requestMatchers("/api/planner/**").permitAll();
                    }
                    auth
                            // The Brief tab's own AI popover
                            // (ComparisonProxyController): read-only, no
                            // account needed to run it.
                            .requestMatchers("/api/comparison/**").permitAll()
                            // The magic-link flow's own two steps -- request
                            // and verify -- happen before any session exists,
                            // the same reason /oauth2/authorization/** and
                            // /login/oauth2/code/** (Spring Security's own
                            // routes for Google/Apple) are never matched
                            // against "anyRequest" here either.
                            .requestMatchers("/api/auth/magic-link/**").permitAll()
                            // Asked before any session exists, to decide
                            // whether a sign-in button is worth showing
                            // at all (SignInCapabilitiesController).
                            .requestMatchers(HttpMethod.GET, "/api/auth/capabilities").permitAll()
                            .requestMatchers(HttpMethod.GET, "/", "/error").permitAll()
                            // Everything else that exists is pilot-scoped.
                            .anyRequest().authenticated();
                })

                // Cookie-based CSRF tokens, readable by script so the
                // front end can echo them back in a header. Session
                // authentication means the browser attaches credentials
                // automatically, which is exactly the condition CSRF
                // exploits, so this stays on.
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                // The handler above resolves the token lazily and nothing
                // server-rendered ever forces it, so without this filter
                // the XSRF-TOKEN cookie is never written and every POST
                // or DELETE fails CSRF validation. See CsrfCookieFilter.
                .addFilterAfter(new CsrfCookieFilter(), CsrfFilter.class)

                // An API answers an unauthenticated call with 401. The
                // default is a 302 to a login page, which a fetch() sees
                // as a confusing 200 for the wrong document. Spring
                // Security's own entry point for exactly this, in place
                // of the one this project wrote: the only difference is
                // that the 401 carries no body, and nothing read it --
                // the browser client treats a 401 from /api/me as the
                // ordinary signed-out answer, and every other call
                // falls back to the status text.
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))

                // Spring Security already writes X-Content-Type-Options
                // and a frame-options header by default; this makes both
                // explicit and adds a CSP. Everything the app loads is
                // same-origin, the map included: its tiles are the
                // FAA's charts, rendered by this app from the FAA's
                // GeoTIFFs and proxied from planning-service
                // (web/src/lib/map/leaflet.tsx). That is what let the
                // old chart mirror's host, the connect-src its dynamic
                // layer needed, and then OpenStreetMap's tile host all
                // go. style-src keeps 'unsafe-inline' for Swagger UI's
                // own inline styles. HSTS is a no-op locally (Spring
                // Security only sends it over a request it sees as
                // secure) and only takes effect once behind a
                // TLS-terminating ALB with
                // server.forward-headers-strategy: framework set.
                .headers(headers -> headers
                        .frameOptions(frame -> frame.deny())
                        .httpStrictTransportSecurity(strict -> { if (!hsts) strict.disable(); })
                        // A magic-link verify URL carries its one-time
                        // token as a query param (?token=...) -- default
                        // browser behaviour would otherwise forward the
                        // full URL, token included, as the Referer header
                        // on the very first outbound request the planner
                        // makes after that redirect. no-referrer drops it
                        // (and every other page's query string) entirely.
                        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.NO_REFERRER))
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; "
                                        + "img-src 'self' data:" + chartTilesOrigin + "; "
                                        + "style-src 'self' 'unsafe-inline'; "
                                        + "script-src 'self'; "
                                        + "connect-src 'self'; "
                                        + "object-src 'none'; "
                                        + "base-uri 'self'; "
                                        + "frame-ancestors 'none'")));

        // logout() is unconditional -- it is plain session invalidation,
        // not specific to OIDC, and a magic-link sign-in (which needs no
        // ClientRegistrationRepository at all) still needs the same
        // /logout endpoint the front end always calls. oauth2Login()
        // alone requires a real registration to exist, which is what
        // stays conditional.
        http.logout(Customizer.withDefaults());
        if (oauthConfigured) {
            http.oauth2Login(Customizer.withDefaults());
        }
        return http.build();
    }
}
