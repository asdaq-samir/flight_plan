package com.northflyers.vfr.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;

/**
 * Who may call what.
 *
 * <p>Two kinds of resource, split on whether the answer depends on who is
 * asking. A scored route is the same for everyone who plans that corridor
 * and stays public. A pilot's aeroplanes and filed flights are theirs,
 * and require a session.
 *
 * <p>Sign-in is Google, and the session is the servlet container's --
 * there is no token minting, refreshing or revocation of our own here,
 * which is the point of choosing OIDC over rolling it. {@code oauth2Login}
 * is registered only when a client id is actually configured, and the
 * failure mode when it is not is that protected endpoints return 401 with
 * no way to log in. That is deliberate: an unconfigured deployment should
 * refuse callers, not admit them.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final boolean googleConfigured;

    SecurityConfig(@Value("${spring.security.oauth2.client.registration.google.client-id:}") String clientId) {
        this.googleConfigured = StringUtils.hasText(clientId);
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
                        .authenticationEntryPoint(new Http401EntryPoint()));

        if (googleConfigured) {
            http.oauth2Login(Customizer.withDefaults());
            http.logout(Customizer.withDefaults());
        }
        return http.build();
    }
}
