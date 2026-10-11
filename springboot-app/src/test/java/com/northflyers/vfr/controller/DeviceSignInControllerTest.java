package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.northflyers.vfr.service.PilotService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

/**
 * Signing a TV in from a phone: the TV's code, typed in by a signed-in
 * pilot, signs the TV in on its own session as that pilot, once; a code
 * mistyped, run out or used signs nobody in, and a signed-out phone
 * approves nothing.
 */
class DeviceSignInControllerTest {

    /** A clock the test moves. */
    static final class Moving extends Clock {
        Instant now = Instant.parse("2026-10-11T12:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private final Moving clock = new Moving();
    private final PilotService pilots = mock(PilotService.class);
    private final Pilot pilot = new Pilot("pilot@example.com", "A Pilot", null, null);
    private final Authentication phone = new MagicLinkAuthenticationToken("pilot@example.com");
    private final DeviceSignInController controller = new DeviceSignInController(pilots, clock);

    DeviceSignInControllerTest() {
        given(pilots.current(phone)).willReturn(Optional.of(pilot));
        given(pilots.current(null)).willReturn(Optional.empty());
        given(pilots.fromVerifiedEmail("pilot@example.com")).willReturn(pilot);
    }

    private DeviceSignInController.DeviceCode start() {
        return (DeviceSignInController.DeviceCode) controller.start(new MockHttpServletRequest()).getBody();
    }

    private int ask(String deviceCode, MockHttpServletRequest tv) {
        return controller.token(new DeviceSignInController.TokenRequest(deviceCode), tv, new MockHttpServletResponse())
                .getStatusCode().value();
    }

    @Test
    void theCodeTypedInOnThePhoneSignsTheTvInAsThatPilotOnce() {
        DeviceSignInController.DeviceCode code = start();
        assertThat(code.userCode()).matches("[" + DeviceSignInController.ALPHABET + "]{4}-[" + DeviceSignInController.ALPHABET + "]{4}");
        assertThat(code.verificationPath()).isEqualTo("/tv");
        assertThat(code.interval()).isEqualTo(DeviceSignInController.INTERVAL_S);
        MockHttpServletRequest tv = new MockHttpServletRequest();

        // Not yet typed in: the TV waits.
        assertThat(ask(code.deviceCode(), tv)).isEqualTo(202);

        // Typed as a pilot types it: lower case, no hyphen.
        String typed = code.userCode().replace("-", "").toLowerCase();
        assertThat(controller.approve(new DeviceSignInController.Approval(typed), phone).getStatusCode().value()).isEqualTo(204);

        var signedIn = controller.token(new DeviceSignInController.TokenRequest(code.deviceCode()), tv, new MockHttpServletResponse());
        assertThat(signedIn.getStatusCode().value()).isEqualTo(200);
        SecurityContext context = (SecurityContext) tv.getSession().getAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        assertThat(context.getAuthentication().getPrincipal()).isEqualTo("pilot@example.com");

        // Spent: asked again, and typed again, it signs nobody in.
        assertThat(ask(code.deviceCode(), new MockHttpServletRequest())).isEqualTo(410);
        assertThat(controller.approve(new DeviceSignInController.Approval(typed), phone).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void aMistypedCodeOrASignedOutPhoneApprovesNothing() {
        DeviceSignInController.DeviceCode code = start();
        // A 0 is never in a code: one no TV is showing.
        assertThat(controller.approve(new DeviceSignInController.Approval("BCDF-GH0K"), phone).getStatusCode().value())
                .isEqualTo(404);
        assertThat(controller.approve(new DeviceSignInController.Approval(code.userCode()), null).getStatusCode().value())
                .isEqualTo(401);
        assertThat(ask(code.deviceCode(), new MockHttpServletRequest())).isEqualTo(202);
        assertThat(ask("not-a-code", new MockHttpServletRequest())).isEqualTo(410);
    }

    @Test
    void aCodeTenMinutesOldHasRunOut() {
        DeviceSignInController.DeviceCode code = start();
        clock.now = clock.now.plus(DeviceSignInController.LIFETIME).plus(Duration.ofSeconds(1));
        assertThat(controller.approve(new DeviceSignInController.Approval(code.userCode()), phone).getStatusCode().value())
                .isEqualTo(404);
        assertThat(ask(code.deviceCode(), new MockHttpServletRequest())).isEqualTo(410);
    }

    @Test
    void aPilotTriesTenCodesInTenMinutesAndNoMore() {
        start();
        for (int i = 0; i < 10; i++) {
            assertThat(controller.approve(new DeviceSignInController.Approval("ZZZZ-ZZZ" + (char) ('0' + i)), phone).getStatusCode().value())
                    .isEqualTo(404);
        }
        assertThat(controller.approve(new DeviceSignInController.Approval("ZZZZ-ZZZZ"), phone).getStatusCode().value())
                .isEqualTo(429);
        clock.now = clock.now.plus(Duration.ofMinutes(11));
        assertThat(controller.approve(new DeviceSignInController.Approval("ZZZZ-ZZZZ"), phone).getStatusCode().value())
                .isEqualTo(404);
    }

    @Test
    void aPlaceAsksForTwentyCodesAnHourAndNoMore() {
        for (int i = 0; i < 20; i++) {
            assertThat(controller.start(new MockHttpServletRequest()).getStatusCode().value()).isEqualTo(200);
        }
        assertThat(controller.start(new MockHttpServletRequest()).getStatusCode().value()).isEqualTo(429);
    }
}
