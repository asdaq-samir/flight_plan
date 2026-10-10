package com.northflyers.vfr.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;

/**
 * The front door, against a real upstream.
 *
 * <p>Every browser-reachable planner path arrives here, and until this
 * existed nothing tested what happens to it. The four behaviours below
 * are the ones that were arrived at the hard way and are easy to lose in
 * a refactor: the path rewrite, the caching rule that applies to chart
 * tiles and nothing else, the streamed body, and the error shape for an
 * upstream that is not answering.
 *
 * <p>The upstream is a real HTTP server on a real socket rather than a
 * mock, because what is being tested is HTTP: a header carried or not
 * carried, a status passed through, a body piped. A mocked client would
 * only assert that this class calls the method it calls.
 */
@WebMvcTest(PlannerProxyController.class)
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
class PlannerProxyControllerTest {

    private static HttpServer upstream;

    /** What the fake planner answers with next, and what it was asked. */
    private static final Map<String, String> responseBody = new ConcurrentHashMap<>();
    private static final Map<String, String> responseHeaders = new ConcurrentHashMap<>();
    private static final List<String> received = new ArrayList<>();
    private static volatile int responseStatus = 200;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @BeforeAll
    static void startUpstream() throws IOException {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/", exchange -> {
            String query = exchange.getRequestURI().getQuery();
            received.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath()
                    + (query == null ? "" : "?" + query));
            received.add("body=" + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            String pilotHeader = exchange.getRequestHeaders().getFirst("X-Pilot-Id");
            if (pilotHeader != null) {
                received.add("pilot=" + pilotHeader);
            }
            String rangeHeader = exchange.getRequestHeaders().getFirst("Range");
            if (rangeHeader != null) {
                received.add("range=" + rangeHeader);
            }

            responseHeaders.forEach((name, value) -> exchange.getResponseHeaders().add(name, value));
            byte[] body = responseBody.getOrDefault("body", "{}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(responseStatus, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.start();
    }

    @AfterAll
    static void stopUpstream() {
        upstream.stop(0);
    }

    @DynamicPropertySource
    static void plannerUrl(DynamicPropertyRegistry registry) {
        registry.add("planner-service.base-url", () -> "http://127.0.0.1:" + upstream.getAddress().getPort());
    }

    @BeforeEach
    void reset() {
        received.clear();
        responseBody.clear();
        responseHeaders.clear();
        responseStatus = 200;
    }

    /** Runs the async dispatch a StreamingResponseBody requires, and
     *  gives back the finished result. */
    private MvcResult finish(MvcResult started) throws Exception {
        return mockMvc.perform(asyncDispatch(started)).andReturn();
    }

    @Test
    void theProxyPrefixIsStrippedAndTheQueryStringIsCarried() throws Exception {
        MvcResult started = mockMvc.perform(get("/api/planner/course?dep=C81&dest=KDLH"))
                .andExpect(request().asyncStarted())
                .andReturn();
        finish(started);

        // /api/planner/course upstream is /api/course -- the planner
        // knows nothing about the prefix this app reaches it behind.
        assertThat(received).contains("GET /api/course?dep=C81&dest=KDLH");
    }

    @Test
    void aPostBodyIsForwardedAsItArrived() throws Exception {
        MvcResult started = mockMvc.perform(post("/api/planner/picks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\":42.0,\"lon\":-88.0}"))
                .andExpect(request().asyncStarted())
                .andReturn();
        finish(started);

        assertThat(received).contains("POST /api/picks");
        assertThat(received).contains("body={\"lat\":42.0,\"lon\":-88.0}");
    }

    @Test
    void aDeleteIsForwardedToo() throws Exception {
        MvcResult started = mockMvc.perform(delete("/api/planner/picks?dep=C81&dest=KDLH&lat=45&lon=-90"))
                .andExpect(request().asyncStarted())
                .andReturn();
        finish(started);

        assertThat(received).contains("DELETE /api/picks?dep=C81&dest=KDLH&lat=45&lon=-90");
    }

    /** Only the planner's own browser-facing routes are forwarded. Its
     *  API docs, its root and any route it grows later are a 404 here,
     *  and the planner is never asked. */
    @Test
    void aPathTheBrowserHasNoUseForIsA404AndNeverReachesThePlanner() throws Exception {
        for (String path : new String[] {"/api/planner/../openapi.json", "/api/planner/docs",
                "/api/planner/openapi.json", "/api/planner/internal/anything"}) {
            mockMvc.perform(get(path)).andExpect(status().isNotFound());
        }
        mockMvc.perform(post("/api/planner/course")).andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/planner/build")).andExpect(status().isNotFound());
        assertThat(received).isEmpty();
    }

    @Test
    void theRouteTableCoversWhatTheBrowserCalls() {
        assertThat(PlannerProxyController.isForwarded("GET", "/api/chart-tile/sectional/10/262/380.png")).isTrue();
        assertThat(PlannerProxyController.isForwarded("POST", "/api/dev/services/ml/start")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/chart")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport/KBUR/procedures")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airspace/ahead")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/traffic")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport/KBUR/procedures/I08-Y")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport/KBUR/procedures/I08-Y/legs")).isFalse();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/foreflight-pack/C81-KDLH/C81-KDLH-checkpoints.zip")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/foreflight-pack")).isFalse();
        assertThat(PlannerProxyController.isForwarded("POST", "/api/oral/question")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/oral/question")).isFalse();
        // Gone with collecting a route: the checkpoints come off the chart.
        assertThat(PlannerProxyController.isForwarded("POST", "/api/build")).isFalse();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/routes")).isFalse();
        assertThat(PlannerProxyController.isForwarded("POST", "/api/checkpoint-notes/generate")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport/KDLH")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airports/in-view")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/waypoints/in-view")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/local-flight")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/tfrs")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/route-profile")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airports/nearest")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/places/search")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport/KDLH/extra")).isFalse();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport-diagram/2610/KDLH.png")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport-diagram/2610/runways/KDLH.png")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/airport-diagram/2610/KDLH.pdf")).isFalse();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/faa-chart")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/faa-chart/page/dtpp/2610/EC3TO.PDF/33.png")).isTrue();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/faa-chart/page/dtpp/2610/EC3TO.PDF")).isFalse();
        assertThat(PlannerProxyController.isForwarded("GET", "/api/chart-tile/sectional/10/262/380.jpg")).isFalse();
        assertThat(PlannerProxyController.isForwarded("POST", "/api/dev/services/ml/stop")).isFalse();
    }

    @Test
    void theUpstreamStatusBodyAndContentTypeCome() throws Exception {
        responseStatus = 422;
        responseBody.put("body", "{\"detail\":\"no such airport\"}");
        responseHeaders.put("Content-Type", "application/json");

        MvcResult started = mockMvc.perform(get("/api/planner/course?dep=XXXX&dest=KDLH"))
                .andExpect(request().asyncStarted())
                .andReturn();

        mockMvc.perform(asyncDispatch(started))
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.detail").value("no such airport"));
    }

    @Test
    void aStreamedResponseAsksIntermediariesNotToBufferIt() throws Exception {
        MvcResult started = mockMvc.perform(get("/api/planner/detect/stream"))
                .andExpect(request().asyncStarted())
                .andReturn();

        // Detection's whole value is that the map fills from the
        // departure end while the rest is still being read; a proxy in
        // front deciding to buffer it undoes that.
        mockMvc.perform(asyncDispatch(started)).andExpect(header().string("X-Accel-Buffering", "no"));
    }

    @Test
    void aChartTileKeepsItsUpstreamCacheControl() throws Exception {
        responseHeaders.put("Cache-Control", "public, max-age=604800");

        // The URL the map actually asks for (web/src/lib/map/tiles.ts),
        // which upstream is /api/chart-tile/... -- the rule is written
        // against the upstream path, not the browser's.
        MvcResult started = mockMvc.perform(get("/api/planner/chart-tile/sectional/10/262/380.png"))
                .andExpect(request().asyncStarted())
                .andReturn();

        // What lets a browser skip asking again for a tile it already
        // has, rather than round-tripping on every pan and zoom.
        mockMvc.perform(asyncDispatch(started))
                .andExpect(header().string("Cache-Control", "public, max-age=604800"));
    }

    @Test
    void theAnswersTheSameForEveryPilotKeepTheirUpstreamCacheControl() throws Exception {
        responseHeaders.put("Cache-Control", "public, max-age=300, s-maxage=3600");

        // The chart, the airport search and the stock aircraft: what the
        // browser and CloudFront may keep (the planner's app.common says
        // for how long), so a pilot typing an ident is answered from the
        // nearest edge.
        for (String path : new String[] {"/api/planner/chart", "/api/planner/airports/search?q=KD",
                "/api/planner/aircraft-profiles"}) {
            MvcResult started = mockMvc.perform(get(path)).andExpect(request().asyncStarted()).andReturn();
            mockMvc.perform(asyncDispatch(started))
                    .andExpect(header().string("Cache-Control", "public, max-age=300, s-maxage=3600"));
        }

        // The fields in view carry each one's METAR: whatever the planner
        // said, not passed on.
        MvcResult inView = mockMvc.perform(get("/api/planner/airports/in-view?south=46&west=-93&north=47&east=-92"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(inView)).andExpect(header().doesNotExist("Cache-Control"));
    }

    @Test
    void theAirportIndexKeepsItsGzipEncodingAndCacheControlAndTheSearchDoesNotGetTheEncoding() throws Exception {
        responseHeaders.put("Content-Encoding", "gzip");
        responseHeaders.put("Vary", "Accept-Encoding");
        responseHeaders.put("Cache-Control", "public, max-age=86400");

        // The phone's own copy of the airport search: sent gzipped by the
        // planner, so the browser has to be told so, or it reads the bytes
        // as they are.
        MvcResult index = mockMvc.perform(get("/api/planner/airports/index")).andExpect(request().asyncStarted()).andReturn();
        mockMvc.perform(asyncDispatch(index))
                .andExpect(header().string("Content-Encoding", "gzip"))
                .andExpect(header().string("Vary", "Accept-Encoding"))
                .andExpect(header().string("Cache-Control", "public, max-age=86400"));

        // Any other path's encoding is not passed on: its body is not the
        // planner's bytes as they came.
        MvcResult search = mockMvc.perform(get("/api/planner/airports/search?q=KD")).andExpect(request().asyncStarted()).andReturn();
        mockMvc.perform(asyncDispatch(search)).andExpect(header().doesNotExist("Content-Encoding"));
    }

    @Test
    void theForeFlightPackKeepsItsFileNameSizeAndRangeAndNoOtherPathDoes() throws Exception {
        responseHeaders.put("Content-Disposition", "attachment; filename=\"C81-KDLH-checkpoints.zip\"");
        responseHeaders.put("Content-Range", "bytes 0-1/2");
        responseHeaders.put("Accept-Ranges", "bytes");
        MvcResult pack = mockMvc.perform(get("/api/planner/foreflight-pack/C81-KDLH/C81-KDLH-checkpoints.zip")
                        .header("Range", "bytes=0-1"))
                .andExpect(request().asyncStarted())
                .andReturn();
        // What a download, and ForeFlight's list of packs, call the file,
        // and what its downloader needs to fetch it in pieces: the range
        // asked for went to the planner, and its size and range came back.
        mockMvc.perform(asyncDispatch(pack))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"C81-KDLH-checkpoints.zip\""))
                .andExpect(header().string("Content-Length", "2"))
                .andExpect(header().string("Content-Range", "bytes 0-1/2"))
                .andExpect(header().string("Accept-Ranges", "bytes"));
        assertThat(received).contains("range=bytes=0-1");

        MvcResult course = mockMvc.perform(get("/api/planner/course?dep=C81&dest=KDLH"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(course)).andExpect(header().doesNotExist("Content-Disposition"));
    }

    @Test
    void theRetiredPerKindTilePathsAreNotForwarded() throws Exception {
        // /api/sectional-tile and /api/tac-tile were the same tiles under
        // older names, with no caller left; the planner no longer has them.
        for (String kind : new String[] {"sectional-tile", "tac-tile"}) {
            mockMvc.perform(get("/api/planner/" + kind + "/10/262/380.png"))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void everyOtherPathDropsAnUpstreamCacheControl() throws Exception {
        responseHeaders.put("Cache-Control", "public, max-age=604800");

        MvcResult started = mockMvc.perform(get("/api/planner/course?dep=C81&dest=KDLH"))
                .andExpect(request().asyncStarted())
                .andReturn();

        // A course depends on saved state and on who is asking; caching
        // it the way a tile is cached would serve one pilot another's.
        mockMvc.perform(asyncDispatch(started)).andExpect(header().doesNotExist("Cache-Control"));
    }

    @Test
    void anUpstreamThatIsNotListeningIsA502WithTheDetailShape() throws Exception {
        // The front end's own stream reader reports `detail`; a 502 with
        // an empty body or an HTML error page would show a pilot nothing.
        MockMvc unreachable = unreachablePlanner();
        MvcResult started = unreachable.perform(get("/api/planner/course"))
                .andExpect(request().asyncStarted())
                .andReturn();

        unreachable.perform(asyncDispatch(started))
                .andExpect(status().is(502))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.detail").value("planner service unreachable"));
    }

    /** A checkpoint note is its pilot's own, so the planner is told who
     *  saved it -- from the session, never from what the browser sent. */
    @Test
    void aNoteCarriesTheSignedInPilotAndNothingTheBrowserClaimed() throws Exception {
        Pilot pilot = org.mockito.Mockito.mock(Pilot.class);
        given(pilot.getId()).willReturn(42L);
        given(pilotService.current(any())).willReturn(Optional.of(pilot));

        finish(mockMvc.perform(post("/api/planner/checkpoint-notes")
                        .header("X-Pilot-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(request().asyncStarted())
                .andReturn());

        assertThat(received).contains("pilot=42").doesNotContain("pilot=7");
    }

    @Test
    void noOtherPathCarriesAPilot() throws Exception {
        finish(mockMvc.perform(get("/api/planner/course?dep=C81&dest=KDLH").header("X-Pilot-Id", "7"))
                .andExpect(request().asyncStarted())
                .andReturn());

        assertThat(received).noneMatch(line -> line.startsWith("pilot="));
    }

    /** A second MockMvc whose planner points at a port nothing is on. */
    private MockMvc unreachablePlanner() {
        PlannerProxyController controller =
                new PlannerProxyController(new StreamingProxy(), "http://127.0.0.1:1", pilotService, 40);
        return standaloneSetup(controller)
                .build();
    }
}
