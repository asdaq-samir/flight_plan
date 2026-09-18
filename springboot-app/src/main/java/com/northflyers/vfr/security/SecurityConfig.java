package com.northflyers.vfr.security;

import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

/**
 * Who may call what.
 *
 * <p>Two kinds of resource, split on whether the answer depends on who is
 * asking. A scored route is the same for everyone who plans that corridor
 * and stays public. A pilot's aeroplanes and filed flights are theirs,
 * and require a session.
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

    SecurityConfig(Optional<ClientRegistrationRepository> clientRegistrations) {
        this.oauthConfigured = clientRegistrations.isPresent();
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(auth -> auth
                        // Health and docs: an orchestrator and a reader,
                        // neither of which can hold a session.
                        .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                        .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                        // Shared, not personal: the same corridor scores
                        // the same for everyone.
                        .requestMatchers("/api/routes/**").permitAll()
                        // The front end itself, and the planner API it
                        // runs on. Open for now because planning a route
                        // needs no account -- the sign-in is for saving
                        // one. Narrowing this is a product decision, and
                        // the matcher is here so it is one line when it
                        // is taken.
                        .requestMatchers("/app", "/app/**").permitAll()
                        .requestMatchers("/api/planner/**").permitAll()
                        // The magic-link flow's own two steps -- request
                        // and verify -- happen before any session exists,
                        // the same reason /oauth2/authorization/** and
                        // /login/oauth2/code/** (Spring Security's own
                        // routes for Google/Apple) are never matched
                        // against "anyRequest" here either.
                        .requestMatchers("/api/auth/magic-link/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/", "/error").permitAll()
                        // Everything else that exists is pilot-scoped.
                        .anyRequest().authenticated())

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
                // as a confusing 200 for the wrong document.
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(new Http401EntryPoint()))

                // Spring Security already writes X-Content-Type-Options
                // and a frame-options header by default; this makes both
                // explicit and adds a CSP. Everything the app actually
                // loads is same-origin except the OSM tile images
                // (web/src/lib/map/leaflet.tsx) -- style-src keeps
                // 'unsafe-inline' for Swagger UI's own inline styles.
                // HSTS is a no-op locally (Spring Security only sends it
                // over a request it sees as secure) and only takes effect
                // once behind a TLS-terminating ALB with
                // server.forward-headers-strategy: framework set.
                .headers(headers -> headers
                        .frameOptions(frame -> frame.deny())
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; "
                                        + "img-src 'self' data: https://tile.openstreetmap.org; "
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
