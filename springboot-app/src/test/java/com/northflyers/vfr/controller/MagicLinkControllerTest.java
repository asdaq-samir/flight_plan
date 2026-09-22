package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.MagicLink;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.service.PilotService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The magic-link flow, which is the one way into this app that does not
 * go through Spring Security's own filter chain: the verify endpoint is
 * its own success handler, so everything that chain would normally do on
 * a successful authentication has to be done here instead. These pin the
 * parts that are easy to leave out and expensive to leave out.
 *
 * <p>Deliberately run with the security filters off, because that is the
 * condition under test: what the controller does on its own, not what
 * the chain would have done around it.
 */
@WebMvcTest(MagicLinkController.class)
@AutoConfigureMockMvc(addFilters = false)
class MagicLinkControllerTest {

    private static final String EMAIL = "pilot@example.com";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MagicLinkRepository magicLinks;

    @MockitoBean
    private PilotService pilots;

    @MockitoBean
    private JavaMailSender mailSender;

    @BeforeEach
    void pilotExists() {
        given(pilots.fromVerifiedEmail(anyString())).willReturn(new Pilot(EMAIL, "A Pilot", null));
    }

    private static String hash(String token) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(token.getBytes(StandardCharsets.UTF_8)));
    }

    /** The token the emailed link carried, recovered from the message
     *  the controller asked to be sent. */
    private String requestAndReadTheEmailedToken() throws Exception {
        mockMvc.perform(post("/api/auth/magic-link")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + EMAIL + "\"}"))
                .andExpect(status().isAccepted());

        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(sent.capture());
        String text = sent.getValue().getText();
        return text.substring(text.indexOf("token=") + "token=".length()).trim();
    }

    @Test
    void askingForALinkAlwaysAnswers202() throws Exception {
        // Answering differently for a known and an unknown address would
        // let a caller enumerate who has an account here.
        mockMvc.perform(post("/api/auth/magic-link")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody@example.com\"}"))
                .andExpect(status().isAccepted());
    }

    @Test
    void onlyTheHashOfTheTokenIsEverStored() throws Exception {
        String token = requestAndReadTheEmailedToken();

        ArgumentCaptor<MagicLink> saved = ArgumentCaptor.forClass(MagicLink.class);
        verify(magicLinks).save(saved.capture());
        // The row is a bearer credential for the address it names, so it
        // holds a hash the way a password column does -- nothing that can
        // sign someone in sits in the database, a backup or a slow query
        // log in cleartext.
        assertThat(saved.getValue().getTokenHash()).isEqualTo(hash(token));
        assertThat(saved.getValue().getTokenHash()).isNotEqualTo(token);
    }

    @Test
    void aGoodTokenSignsThePilotInAndRedirectsIntoTheApp() throws Exception {
        String token = requestAndReadTheEmailedToken();
        given(magicLinks.consumeIfUsable(anyString(), any())).willReturn(1);
        given(magicLinks.findByTokenHash(anyString())).willReturn(Optional.of(link()));

        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(get("/api/auth/magic-link/verify").param("token", token).session(session))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", "/app/plan"));

        SecurityContext context = (SecurityContext) session.getAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        assertThat(context).isNotNull();
        assertThat(context.getAuthentication().getPrincipal()).isEqualTo(EMAIL);
    }

    @Test
    void signingInChangesTheSessionId() throws Exception {
        // Session fixation. This endpoint is outside the filter chain, so
        // nothing else applies Spring Security's own session-fixation
        // strategy to it: without this, someone who can plant a session
        // cookie on a pilot's browser before they click the link keeps a
        // signed-in session afterwards.
        String token = requestAndReadTheEmailedToken();
        given(magicLinks.consumeIfUsable(anyString(), any())).willReturn(1);
        given(magicLinks.findByTokenHash(anyString())).willReturn(Optional.of(link()));

        MockHttpSession session = new MockHttpSession();
        String before = session.getId();

        mockMvc.perform(get("/api/auth/magic-link/verify").param("token", token).session(session))
                .andExpect(status().isFound());

        assertThat(session.getId()).isNotEqualTo(before);
    }

    @Test
    void aTokenThatLostTheRaceIsRefusedRatherThanSigningInTwice() throws Exception {
        // consumeIfUsable updating no rows is the one signal: already
        // used, expired, or never existed, deliberately indistinguishable.
        String token = requestAndReadTheEmailedToken();
        given(magicLinks.consumeIfUsable(anyString(), any())).willReturn(0);

        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(get("/api/auth/magic-link/verify").param("token", token).session(session))
                .andExpect(status().isBadRequest());

        assertThat(session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY)).isNull();
    }

    @Test
    void anUnrecognisedTokenIsRefused() throws Exception {
        given(magicLinks.consumeIfUsable(anyString(), any())).willReturn(0);

        mockMvc.perform(get("/api/auth/magic-link/verify").param("token", "not-a-real-token"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theEmailedLinkPointsAtTheVerifyEndpoint() throws Exception {
        mockMvc.perform(post("/api/auth/magic-link")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + EMAIL + "\"}"))
                .andExpect(status().isAccepted());

        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(sent.capture());
        assertThat(sent.getValue().getText()).contains("/api/auth/magic-link/verify?token=");
        assertThat(sent.getValue().getTo()).containsExactly(EMAIL);
    }

    private static MagicLink link() {
        return new MagicLink(EMAIL, "whatever", Instant.now().plusSeconds(600));
    }
}
