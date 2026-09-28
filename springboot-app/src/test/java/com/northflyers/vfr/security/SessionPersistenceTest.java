package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * A sign-in is kept in Postgres (spring-session-jdbc, Flyway's V8) and
 * lasts 30 days of disuse, rather than living in the JVM for half an
 * hour: a pilot signs in once per device a month, and a webapp restart
 * no longer signs everyone out.
 *
 * <p>Against a real Postgres, because the parts that can break are the
 * migration and the serialisation of what the session holds -- the
 * signed-in security context -- into its bytea column.
 */
@SpringBootTest
@Testcontainers
class SessionPersistenceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private FindByIndexNameSessionRepository<? extends Session> sessions;

    @Test
    void aSignedInSessionIsStoredAndLastsThirtyDays() {
        roundTrip(sessions);
    }

    private <S extends Session> void roundTrip(FindByIndexNameSessionRepository<S> repository) {
        S session = repository.createSession();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new MagicLinkAuthenticationToken("pilot@example.com"));
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        repository.save(session);

        S stored = repository.findById(session.getId());
        assertThat(stored).isNotNull();
        assertThat(stored.getMaxInactiveInterval()).isEqualTo(Duration.ofDays(30));
        SecurityContext restored = stored.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        assertThat(restored.getAuthentication().getName()).isEqualTo("pilot@example.com");
        assertThat(repository.findByPrincipalName("pilot@example.com")).containsKey(session.getId());
    }
}
