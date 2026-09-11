package com.northflyers.vfr.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Forces the {@code XSRF-TOKEN} cookie to actually be written.
 *
 * <p>{@code CsrfTokenRequestAttributeHandler} resolves the token lazily:
 * the deferred supplier only saves it to the cookie repository once
 * something calls {@code getToken()} on it, which a server-rendered page
 * does by referencing {@code ${_csrf}} in a template. Nothing here does
 * that -- every response is JSON -- so without this filter the cookie is
 * never set on any request, {@code client.ts}'s {@code csrfHeader()}
 * never finds one to echo back, and every POST or DELETE fails CSRF
 * validation. Because the caller is anonymous, Spring Security reports
 * that failure through the entry point rather than the access-denied
 * handler, so it surfaces as 401 "authentication required" -- a
 * misleading message for what is actually a missing cookie.
 */
class CsrfCookieFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        CsrfToken csrfToken = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        if (csrfToken != null) {
            csrfToken.getToken();
        }
        filterChain.doFilter(request, response);
    }
}
