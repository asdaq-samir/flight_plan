package com.northflyers.vfr.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.service.PilotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.filter.ForwardedHeaderFilter;

/**
 * Asking for sign-in links is throttled, with the real limits: nobody
 * can fill a stranger's inbox from the sign-in form, and the answer for
 * a throttled address says nothing about whether it has an account.
 */
@WebMvcTest(MagicLinkController.class)
@AutoConfigureMockMvc(addFilters = false)
class MagicLinkThrottleTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MagicLinkRepository magicLinks;

    @MockitoBean
    private PilotService pilots;

    @MockitoBean
    private JavaMailSender mailSender;

    private void ask(String email, String client, int expected) throws Exception {
        mockMvc.perform(post("/api/auth/magic-link")
                        .with(request -> { request.setRemoteAddr(client); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().is(expected));
    }

    @Test
    void theSixthLinkInAnHourForOneAddressIsRefused() throws Exception {
        for (int i = 0; i < 5; i++) {
            ask("target@example.com", "10.0.0." + i, 202);
        }
        ask("TARGET@example.com", "10.0.0.99", 429);
        ask("someone-else@example.com", "10.0.0.99", 202);
    }

    @Autowired
    private WebApplicationContext context;

    /** Through the filter `forward-headers-strategy: framework` installs,
     *  as the deployed app is -- which makes getRemoteAddr() the first
     *  X-Forwarded-For entry. */
    private void askThrough(String email, String forwardedFor, int expected) throws Exception {
        MockMvc behindTheBalancer = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(new ForwardedHeaderFilter())
                .build();
        behindTheBalancer.perform(post("/api/auth/magic-link")
                        .with(request -> { request.setRemoteAddr("10.0.1.5"); return request; })   // the load balancer
                        .header("X-Forwarded-For", forwardedFor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().is(expected));
    }

    @Test
    void aForwardedForTheCallerWritesDoesNotMakeANewCaller() throws Exception {
        // The first entry is whatever the caller sent; the load balancer
        // appends the address it was connected from. Keyed on the first,
        // a new one per request dodged the limit.
        for (int i = 0; i < 20; i++) {
            askThrough("spray" + i + "@example.com", "203.0.113." + i + ", 198.51.100.7", 202);
        }
        askThrough("spray-last@example.com", "203.0.113.99, 198.51.100.7", 429);
        askThrough("someone@example.com", "198.51.100.8", 202);
    }

    @Test
    void oneCallerCannotSprayAddresses() throws Exception {
        for (int i = 0; i < 20; i++) {
            ask("spray" + i + "@example.com", "192.0.2.7", 202);
        }
        ask("spray-last@example.com", "192.0.2.7", 429);
    }
}
