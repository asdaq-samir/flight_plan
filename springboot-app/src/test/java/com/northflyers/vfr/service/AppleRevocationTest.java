package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;

/** What Apple is sent when a deleted pilot's refresh token is revoked. */
class AppleRevocationTest {

    private HttpServer apple;
    private final List<String> asked = new CopyOnWriteArrayList<>();
    private volatile int answer = 200;

    @BeforeEach
    void startApple() throws IOException {
        apple = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        apple.createContext("/auth/revoke", exchange -> {
            asked.add(exchange.getRequestMethod() + " " + exchange.getRequestHeaders().getFirst("Content-Type")
                    + " " + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(answer, -1);
            exchange.close();
        });
        apple.start();
    }

    @AfterEach
    void stopApple() {
        apple.stop(0);
    }

    private AppleRevocation revocation(boolean configured) {
        Optional<InMemoryClientRegistrationRepository> registrations = Optional.of(configured
                ? new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("apple")
                        .clientId("com.example.services").clientSecret("signed.jwt.secret")
                        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                        .redirectUri("http://localhost/cb").authorizationUri("https://example.com/a")
                        .tokenUri("https://example.com/t").build())
                : new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("other")
                        .clientId("x").clientSecret("y")
                        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                        .redirectUri("http://localhost/cb").authorizationUri("https://example.com/a")
                        .tokenUri("https://example.com/t").build()));
        return new AppleRevocation(registrations.map(r -> r),
                "http://127.0.0.1:" + apple.getAddress().getPort() + "/auth/revoke");
    }

    @Test
    void sendsTheTokenWithTheServicesIdAndSecretAsAForm() {
        revocation(true).revoke("r.refresh+token");

        assertThat(asked).containsExactly("POST application/x-www-form-urlencoded "
                + "client_id=com.example.services&client_secret=signed.jwt.secret"
                + "&token=r.refresh%2Btoken&token_type_hint=refresh_token");
    }

    @Test
    void aPilotWithoutATokenAsksNothing() {
        revocation(true).revoke(null);
        revocation(true).revoke(" ");

        assertThat(asked).isEmpty();
    }

    @Test
    void withoutAppleConfiguredNothingIsSent() {
        revocation(false).revoke("token");

        assertThat(asked).isEmpty();
    }

    @Test
    void appleRefusingDoesNotRaise() {
        answer = 400;

        assertThatCode(() -> revocation(true).revoke("token")).doesNotThrowAnyException();
        assertThat(asked).hasSize(1);
    }
}
