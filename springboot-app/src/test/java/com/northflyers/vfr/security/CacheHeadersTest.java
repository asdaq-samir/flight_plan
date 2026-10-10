package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.Filter;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.header.HeaderWriterFilter;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * What a browser and CloudFront may keep, through the whole filter chain
 * as deployed: the answers the same for every pilot keep the planner's
 * {@code public} Cache-Control, and nothing of one pilot's -- a flight,
 * the account, a planner answer with weather in it -- is ever anything
 * but {@code no-store}. CloudFront caches by these headers
 * (infra/cloudformation/template.yaml), so a {@code public} on the wrong
 * answer would serve one pilot's to the next.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class CacheHeadersTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    /** A planner that says every answer may be kept, so it is this app
     *  that decides which ones are. */
    private static HttpServer planner;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private FilterChainProxy filterChains;

    @BeforeAll
    static void startPlanner() throws IOException {
        planner = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        planner.createContext("/", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.getResponseHeaders().add("Cache-Control", "public, max-age=300, s-maxage=3600");
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        planner.start();
    }

    @AfterAll
    static void stopPlanner() {
        planner.stop(0);
    }

    @DynamicPropertySource
    static void plannerUrl(DynamicPropertyRegistry registry) {
        registry.add("planner-service.base-url", () -> "http://127.0.0.1:" + planner.getAddress().getPort());
    }

    private MockHttpServletResponse planner(String path) throws Exception {
        MvcResult started = mockMvc.perform(get(path)).andReturn();
        return mockMvc.perform(asyncDispatch(started)).andReturn().getResponse();
    }

    @Test
    void theAirportSearchMayBeKeptByEveryone() throws Exception {
        MockHttpServletResponse search = planner("/api/planner/airports/search?q=KD");
        assertThat(search.getStatus()).isEqualTo(200);
        assertThat(search.getHeaders("Cache-Control")).containsExactly("public, max-age=300, s-maxage=3600");
        // Nothing of the no-store it replaced (SecurityConfig writes it as
        // the request comes in) is left to contradict it.
        for (String stale : new String[] {"Pragma", "Expires"}) {
            assertThat(String.join("", search.getHeaders(stale))).as(stale).isEmpty();
        }
    }

    /**
     * The security headers are written as a request comes in, so nothing
     * writes them after a planner answer starts down its own thread: the
     * request's thread leaving the filter chain wrote them as that thread
     * committed the response, and Tomcat's header table, two threads in it
     * at once, threw (SecurityConfig). Not observable from one request in
     * a test, so the setting itself is held to.
     */
    @Test
    void theSecurityHeadersAreWrittenBeforeAnAnswerIsPiped() {
        List<Filter> filters = filterChains.getFilterChains().getFirst().getFilters();
        assertThat(filters).filteredOn(HeaderWriterFilter.class::isInstance).singleElement()
                .extracting(filter -> ReflectionTestUtils.getField(filter, "shouldWriteHeadersEagerly"))
                .isEqualTo(true);
    }

    @Test
    void anAirportDiagramMayBeKeptByEveryone() throws Exception {
        MockHttpServletResponse diagram = planner("/api/planner/airport-diagram/2610/KDLH.png");
        assertThat(diagram.getStatus()).isEqualTo(200);
        assertThat(diagram.getHeaders("Cache-Control")).containsExactly("public, max-age=300, s-maxage=3600");
    }

    @Test
    void anFaaChartsPagesMayBeKeptByEveryone() throws Exception {
        for (String path : new String[] {"/api/planner/faa-chart?url=https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF&airport=KMSN",
                "/api/planner/faa-chart/page/dtpp/2610/EC3TO.PDF/33.png"}) {
            MockHttpServletResponse answer = planner(path);
            assertThat(answer.getHeaders("Cache-Control")).as(path).containsExactly("public, max-age=300, s-maxage=3600");
        }
    }

    @Test
    void anAnswerWithWeatherOrARouteInItIsNeverKept() throws Exception {
        for (String path : new String[] {"/api/planner/airports/in-view?south=46&west=-93&north=47&east=-92",
                "/api/planner/course?dep=C81&dest=KDLH"}) {
            MockHttpServletResponse answer = planner(path);
            assertThat(String.join(", ", answer.getHeaders("Cache-Control"))).as(path).contains("no-store")
                    .doesNotContain("public");
        }
    }

    @Test
    void aPilotsOwnIsNeverKeptSignedInOrNot() throws Exception {
        for (String path : new String[] {"/api/me", "/api/flights"}) {
            MockHttpServletResponse signedOut = mockMvc.perform(get(path)).andReturn().getResponse();
            assertThat(signedOut.getHeader("Cache-Control")).as(path).contains("no-store");
            MockHttpServletResponse signedIn = mockMvc.perform(get(path).with(user("pilot@example.com")))
                    .andReturn().getResponse();
            assertThat(signedIn.getHeader("Cache-Control")).as(path).contains("no-store");
        }
    }
}
