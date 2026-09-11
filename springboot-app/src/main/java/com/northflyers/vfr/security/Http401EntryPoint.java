package com.northflyers.vfr.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * Answers an unauthenticated API call with 401 and a JSON body.
 *
 * <p>Spring Security's default is a redirect to a login page, which is
 * right for a server-rendered app and wrong here: a {@code fetch} follows
 * it and reports a 200 carrying HTML, so the caller sees a successful
 * request for a document it did not ask for rather than "log in".
 */
class Http401EntryPoint implements AuthenticationEntryPoint {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"authentication required\"}");
    }
}
