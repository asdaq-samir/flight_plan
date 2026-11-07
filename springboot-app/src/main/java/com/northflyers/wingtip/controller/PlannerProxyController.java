package com.northflyers.wingtip.controller;

import com.northflyers.wingtip.domain.PaidFeature;
import com.northflyers.wingtip.service.PilotService;
import com.northflyers.wingtip.service.SubscriptionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.PathContainer;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * The planner's API, reached through this service rather than directly.
 *
 * <p>Chart reading is Python's -- numpy and scipy over raster tiles, and
 * there is no reason to rewrite that in Java. What there is reason to do
 * is stop it being a second front door. With this in place the planner
 * service publishes no port of its own, and every browser-reachable path
 * arrives here, where the session already exists and one set of rules
 * applies.
 *
 * <p>Responses are piped rather than buffered, by {@link StreamingProxy},
 * which also owns the pinned HTTP/1.1 client and the error shape.
 * Detection streams newline-delimited JSON a tile block at a time so the
 * map fills from the departure end while the rest is still being read;
 * collecting that into a String before forwarding it would turn a
 * progressive response into a five-second wait.
 */
@RestController
@RequestMapping("/api/planner")
@Tag(name = "Planner", description = "Chart vision, course and nav log, proxied from the planner service")
public class PlannerProxyController {

    /** Long, because a cold corridor read is tens of seconds and a
     *  collection job is minutes. The client is what should give up. */
    private static final Duration TIMEOUT = Duration.ofMinutes(10);

    private static final StreamingProxy.Upstream PLANNER = new StreamingProxy.Upstream(
            "planner service", "planner service unreachable", "planner service timed out");

    /** The chart tiles, every kind under one path. These carry their
     *  upstream's Cache-Control -- see {@link #forward}. */
    private static final String TILE_PATH = "/api/chart-tile/";
    /** The other answers that carry their upstream's Cache-Control: the
     *  same for every pilot, with no weather in them (the planner's
     *  app.common SHARED_CACHE and CHART_CACHE say why each). */
    static final Set<String> SHARED_PATHS = Set.of("/api/chart", "/api/airports/search", "/api/airports/index", "/api/aircraft-profiles");
    /** The airport search's index, for the phone to search on its own: the
     *  planner sends it gzipped (530 KB of 1.8 MB), so its encoding is
     *  passed on with it, the bytes as they came. */
    static final String INDEX_PATH = "/api/airports/index";
    /** An airport diagram's picture, its d-TPP cycle in its address: the
     *  same for every pilot for the cycle, so its upstream's Cache-Control
     *  is carried too. */
    private static final String DIAGRAM_PATH = "/api/airport-diagram/";
    // An airport's aerial photo, kept a week by the browser as the planner says.
    private static final String AERIAL_PATH = "/api/airport-aerial/";
    private static final String PHOTO_PATH = "/api/airport-photo/";

    /** An airport's services and its pictures' list (/api/airport/{ident}/services,
     *  /photos): from the FAA's airport file, the places near it and its
     *  article, the same for every pilot and no weather in them, so their
     *  upstream's Cache-Control is carried -- the card asked for them afresh
     *  on every opening. */
    static boolean isAirportExtra(String path) {
        return path.startsWith("/api/airport/") && (path.endsWith("/services") || path.endsWith("/photos"));
    }

    /** The overlay tiles' archive itself (/api/overlay-tiles/{name}.pmtiles),
     *  not their index. */
    static boolean isOverlayArchive(String path) {
        return path.startsWith(OVERLAY_TILES_PATH + "/");
    }
    /** An approach's plate placed on the map (the planner's wingtip.plates),
     *  its d-TPP cycle in its address: carried as the diagram's. */
    private static final String PLATE_PATH = "/api/approach-plate/";
    /** The FAA's charts' pages, their edition in their address too (the
     *  list by the chart's own, in its query): carried as the diagram's. */
    private static final String FAA_CHART_PATH = "/api/faa-chart";
    /** The phones' cycle packs (the planner's wingtip.pack): the list of them,
     *  kept as the airport search is, and each region's, its cycle in its
     *  address, kept as an airport diagram is. Both carry their
     *  upstream's Cache-Control. */
    static final String CYCLE_PACKS_PATH = "/api/cycle-packs";
    private static final String CYCLE_PACK_PATH = "/api/cycle-pack/";
    /** The map's FAA overlays as vector tiles (the planner's
     *  wingtip.vector_tiles): the index, kept as the airport search is, and
     *  the cycle's PMTiles archive, its build in its name, kept as an
     *  airport diagram is. The map reads the archive in byte ranges, so the
     *  Range asked and the range answered are passed on as the ForeFlight
     *  pack's are. */
    static final String OVERLAY_TILES_PATH = "/api/overlay-tiles";
    /** The ForeFlight pack: a file, its name in Content-Disposition. */
    private static final String PACK_PATH = "/api/foreflight-pack/";

    private record Route(String method, PathPattern pattern) {
        boolean matches(String method, PathContainer path) {
            return this.method.equals(method) && pattern.matches(path);
        }
    }

    private static Route route(String method, String pattern) {
        return new Route(method, PathPatternParser.defaultInstance.parse(pattern));
    }

    /**
     * Every planner endpoint the browser may reach, and nothing else.
     *
     * <p>Forwarding {@code /**} whole made every route the planner ever
     * grew public the day it was added, its own API docs included, and
     * left the access rules in {@code SecurityConfig} as the only thing
     * between a caller and the service. A path not listed here is a 404
     * from this class, and the planner is never asked.
     */
    private static final List<Route> ROUTES = List.of(
            route("GET", "/api/chart"),
            route("GET", "/api/course"),
            route("GET", "/api/checkpoints"),
            route("GET", PACK_PATH + "{route}/{file}"),
            route("GET", "/api/navlog"),
            route("GET", "/api/local-flight"),
            route("GET", "/api/briefing"),
            // The Brief's Go / No-Go for the native app: a POST for the
            // pilot's own inputs it is worked out with, which change nothing.
            route("POST", "/api/go-no-go"),
            // The native app's figures the web works out on the page: a
            // flown track's debrief and lost comms' altitudes are POSTs
            // for the track and the segments they are worked out from,
            // and change nothing; the diversion and the hold are GETs.
            route("POST", "/api/debrief"),
            route("POST", "/api/lost-comms"),
            route("GET", "/api/diversion"),
            route("GET", "/api/holding"),
            route("GET", "/api/tfrs"),
            route("GET", "/api/map/ages"),
            route("GET", "/api/alternate"),
            route("GET", "/api/route-profile"),
            // FPL's Routes: the ways round storms, weather and high ground.
            route("GET", "/api/route-options"),
            route("GET", "/api/class-b"),
            route("GET", "/api/airspace/at"),
            route("GET", "/api/airspace/ahead"),
            // The map's Class B, C and D lines and labels, over the chart.
            route("GET", "/api/airspace/in-view"),
            route("GET", "/api/weather/map"),
            route("GET", "/api/traffic"),
            route("GET", "/api/traffic/find"),
            route("GET", "/api/traffic/based"),
            route("GET", "/api/traffic/flight/{hex}"),
            route("GET", "/api/traffic/flight/{hex}/history"),
            route("GET", "/api/traffic/flight/{hex}/history/{flight}"),
            route("GET", "/api/traffic/flight/{hex}/status"),
            route("GET", "/api/traffic/route"),
            route("GET", "/api/map/google"),
            route("GET", "/api/airports/search"),
            route("GET", INDEX_PATH),
            route("GET", "/api/airports/in-view"),
            route("GET", "/api/waypoints/in-view"),
            // The map's VORs, and close in the enroute chart's fixes.
            route("GET", "/api/navaids/in-view"),
            route("GET", "/api/airports/nearest"),
            // The map's Stops: fields with fuel, food, repair or a flight school, round the pilot or along the route.
            route("GET", "/api/stops/near"),
            route("GET", "/api/stops/along"),
            route("GET", "/api/places/search"),
            route("GET", "/api/airport/{ident}"),
            route("GET", "/api/airport/{ident}/forecast-wind"),
            // What a field offers a pilot who lands there: a stop's card.
            route("GET", "/api/airport/{ident}/services"),
            // The pictures behind the card's diagram, and its aerial.
            route("GET", "/api/airport/{ident}/photos"),
            route("GET", AERIAL_PATH + "{ident}.jpg"),
            route("GET", PHOTO_PATH + "{ident}.jpg"),
            route("GET", "/api/airport/{ident}/procedures"),
            route("GET", "/api/airport/{ident}/procedures/{procedure}"),
            route("GET", "/api/airport/{ident}/procedures/{procedure}/plate"),
            route("GET", PLATE_PATH + "{cycle}/{ident}/{procedure}.png"),
            route("GET", DIAGRAM_PATH + "{cycle}/{ident}.png"),
            route("GET", DIAGRAM_PATH + "{cycle}/runways/{ident}.png"),
            route("GET", FAA_CHART_PATH),
            route("GET", FAA_CHART_PATH + "/page/{source}/{edition}/{pdf}/{page}.png"),
            route("GET", "/api/aircraft-profiles"),
            // An ATC clearance heard by the phone: its places found, and
            // the names to listen for before it is said.
            route("POST", "/api/clearance/places"),
            route("GET", "/api/clearance/words"),
            route("GET", "/api/chart-tile/{kind}/{z}/{x}/{y}.png"),
            // The phones' packs, for the airspace with no network.
            route("GET", CYCLE_PACKS_PATH),
            route("GET", CYCLE_PACK_PATH + "{cycle}/{file}"),
            // The map's airspace, airports, navaids and fixes as vector tiles.
            route("GET", OVERLAY_TILES_PATH),
            route("GET", OVERLAY_TILES_PATH + "/{file}"),
            route("POST", "/api/checkpoint-notes"),
            route("POST", "/api/checkpoint-notes/generate"),
            // The words with their sources, for the apps' "In words" sections
            // (the planner's POST /api/words/{notams,weather,risk,debrief,changes}).
            route("POST", "/api/words/{kind}"),
            // The pilot's assistant, streamed line by line (NDJSON) as the
            // planner answers; StreamingProxy passes each chunk on as it comes.
            route("POST", "/api/assistant"),
            // The developer's.
            route("POST", "/api/oral/question"),
            route("POST", "/api/oral/grade"),
            route("GET", "/api/detect/stream"),
            route("GET", "/api/classify"),
            route("POST", "/api/picks"),
            route("DELETE", "/api/picks"),
            route("GET", "/api/model-comparison"),
            route("GET", "/api/status"),
            route("POST", "/api/retrain"),
            route("POST", "/api/charts/refresh"),
            route("GET", "/api/dev/services"),
            route("POST", "/api/dev/services/{service}/start"));

    static boolean isForwarded(String method, String upstreamPath) {
        if (!isPlain(upstreamPath)) {
            return false;
        }
        PathContainer path = PathContainer.parsePath(upstreamPath);
        return ROUTES.stream().anyMatch(route -> route.matches(method, path));
    }

    /** Who a checkpoint note belongs to, for the planner (its
     *  routers/notes.py). Set here from the session and never from the
     *  browser: no request header is forwarded but Content-Type. */
    static final String PILOT_HEADER = "X-Pilot-Id";

    private final StreamingProxy proxy;
    private final String plannerBaseUrl;
    private final PilotService pilots;
    /** A day's checkpoint-note generations per pilot: each is one Claude
     *  call per checkpoint without a note, which this app pays for. */
    private final SlidingWindowLimiter noteGenerations = new SlidingWindowLimiter(Duration.ofDays(1));
    private final int noteGenerationsPerDay;
    private final SubscriptionService subscriptions;

    /** The planner's paid features, each a Claude call this app pays for:
     *  checked against the pilot's subscription and its monthly cap
     *  (SubscriptionService) before the planner is asked. Saving a
     *  pilot's own note is free. */
    static final Map<String, PaidFeature> PAID_PATHS = Map.of(
            "/api/checkpoint-notes/generate", PaidFeature.CHECKPOINT_NOTES,
            "/api/oral/question", PaidFeature.ORAL,
            "/api/oral/grade", PaidFeature.ORAL);

    public PlannerProxyController(
            StreamingProxy proxy,
            @Value("${planner-service.base-url:http://planning-service:8000}") String plannerBaseUrl,
            PilotService pilots,
            SubscriptionService subscriptions,
            @Value("${app.paid-calls.per-day:40}") int noteGenerationsPerDay) {
        this.proxy = proxy;
        this.plannerBaseUrl = plannerBaseUrl.replaceAll("/+$", "");
        this.pilots = pilots;
        this.subscriptions = subscriptions;
        this.noteGenerationsPerDay = noteGenerationsPerDay;
    }

    @Operation(summary = "Any planner GET",
            description = "course, detect/stream, classify, picks, checkpoints, navlog, routes, build status")
    @GetMapping("/**")
    public ResponseEntity<StreamingResponseBody> get(HttpServletRequest request, HttpServletResponse servletResponse) {
        return forward(request, servletResponse, "GET", null);
    }

    @Operation(summary = "Any planner POST", description = "picks, build")
    @PostMapping("/**")
    public ResponseEntity<StreamingResponseBody> post(HttpServletRequest request, HttpServletResponse servletResponse,
                                                      @RequestBody(required = false) String body) {
        return forward(request, servletResponse, "POST", body);
    }

    @Operation(summary = "Any planner DELETE", description = "picks")
    @DeleteMapping("/**")
    public ResponseEntity<StreamingResponseBody> delete(HttpServletRequest request, HttpServletResponse servletResponse) {
        return forward(request, servletResponse, "DELETE", null);
    }

    private ResponseEntity<StreamingResponseBody> forward(HttpServletRequest request, HttpServletResponse servletResponse,
                                                          String method, String body) {
        String path = upstreamPath(request);
        if (!isForwarded(method, path)) {
            return StreamingProxy.error(404, "no such planner endpoint: " + method + " " + path);
        }
        PaidFeature paid = "POST".equals(method) ? PAID_PATHS.get(path) : null;
        if (paid != null) {
            var refused = subscriptions.refusal(SecurityContextHolder.getContext().getAuthentication(), paid);
            if (refused.isPresent()) {
                return StreamingProxy.error(refused.get().status(), refused.get().detail());
            }
        }
        if ("POST".equals(method) && path.equals("/api/checkpoint-notes/generate")
                && !noteGenerations.allow(SlidingWindowLimiter.callerOf(request), noteGenerationsPerDay, Instant.now())) {
            return StreamingProxy.error(429, "That is today's " + noteGenerationsPerDay
                    + " checkpoint-note generations used. Notes already written still show; more tomorrow.");
        }
        URI target = URI.create(plannerBaseUrl + path + query(request));

        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8);
        HttpRequest.Builder upstreamBuilder = HttpRequest.newBuilder(target)
                .method(method, publisher)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .timeout(TIMEOUT);
        // A pilot's own edit to a checkpoint note is theirs alone, so the
        // planner is told whose it is. Only for the notes: looking the
        // pilot up is a database call, and a tile request has no use for it.
        if (path.startsWith("/api/checkpoint-notes")) {
            pilots.current(SecurityContextHolder.getContext().getAuthentication())
                    .ifPresent(pilot -> upstreamBuilder.header(PILOT_HEADER, String.valueOf(pilot.getId())));
        }
        // ForeFlight's downloader asks for the pack in byte ranges, and the
        // map for the overlay tiles' archive.
        String range = request.getHeader(HttpHeaders.RANGE);
        if ((path.startsWith(PACK_PATH) || isOverlayArchive(path)) && range != null) {
            upstreamBuilder.header(HttpHeaders.RANGE, range);
        }
        HttpRequest upstream = upstreamBuilder.build();

        return proxy.exchange(PLANNER, upstream, response -> {
            ResponseEntity.BodyBuilder builder = StreamingProxy.unbuffered(
                    ResponseEntity.status(response.statusCode())
                            .header(HttpHeaders.CONTENT_TYPE, StreamingProxy.contentTypeOf(response)));
            // Forwarded for the chart tiles, the airport diagrams and the
            // few answers the same for every pilot (SHARED_PATHS): their
            // `public, max-age=...`
            // is what lets the browser, and CloudFront in front of this
            // app, skip asking again for what it already has -- a tile on
            // every pan and zoom, the airport search on every letter.
            // Every other route under /api/planner/** (course, navlog,
            // the fields in view with their METARs, picks, ...) depends
            // on saved state, live weather or a request body, so a
            // Cache-Control it happened to emit must not be echoed the
            // same way: Spring Security's no-store stands.
            // Set on the response itself, replacing that no-store, which
            // Spring Security has written by now (SecurityConfig: written
            // as the request comes in); a header of the ResponseEntity's
            // is added beside it, and the two read as no-store. Its Pragma
            // and Expires are emptied, as Spring's static resources do.
            if (path.startsWith(TILE_PATH) || path.startsWith(DIAGRAM_PATH) || path.startsWith(PLATE_PATH) || path.startsWith(FAA_CHART_PATH)
                    || path.startsWith(AERIAL_PATH) || path.startsWith(PHOTO_PATH)
                    || path.equals(CYCLE_PACKS_PATH) || path.startsWith(CYCLE_PACK_PATH)
                    || path.equals(OVERLAY_TILES_PATH) || isOverlayArchive(path)
                    || isAirportExtra(path)
                    || SHARED_PATHS.contains(path)) {
                response.headers().firstValue(HttpHeaders.CACHE_CONTROL).ifPresent(value -> {
                    servletResponse.setHeader(HttpHeaders.CACHE_CONTROL, value);
                    for (String stale : new String[] {HttpHeaders.PRAGMA, HttpHeaders.EXPIRES}) {
                        if (servletResponse.containsHeader(stale)) {
                            servletResponse.setHeader(stale, "");
                        }
                    }
                });
            }
            // The airport search's index, gzipped by the planner: what it
            // is encoded in, and that the encoding varies with the ask.
            if (path.equals(INDEX_PATH)) {
                for (String name : new String[] {HttpHeaders.CONTENT_ENCODING, HttpHeaders.VARY}) {
                    response.headers().firstValue(name).ifPresent(value -> builder.header(name, value));
                }
            }
            // The pack's file name, which a download (and ForeFlight's
            // list of packs) shows, and what a download manager needs to
            // fetch it in pieces: its size, and the range each answer is.
            // ForeFlight would not install a pack sent without its size.
            if (path.startsWith(PACK_PATH)) {
                for (String name : new String[] {HttpHeaders.CONTENT_DISPOSITION, HttpHeaders.CONTENT_LENGTH,
                        HttpHeaders.CONTENT_RANGE, HttpHeaders.ACCEPT_RANGES}) {
                    response.headers().firstValue(name).ifPresent(value -> builder.header(name, value));
                }
            }
            // The overlay tiles' archive: the range each answer is, and its
            // ETag, which the map's PMTiles reader checks every range against
            // so a new build is never read half old and half new.
            if (isOverlayArchive(path)) {
                for (String name : new String[] {HttpHeaders.CONTENT_LENGTH, HttpHeaders.CONTENT_RANGE,
                        HttpHeaders.ACCEPT_RANGES, HttpHeaders.ETAG}) {
                    response.headers().firstValue(name).ifPresent(value -> builder.header(name, value));
                }
            }
            return builder.body(StreamingProxy.pipe(response.body()));
        });
    }

    /** Whether the raw path means at the planner what it matched here: one
     *  absolute path, no scheme-relative "//" to name another host, no
     *  backslash, no "." or ".." segment, and no encoded slash, backslash
     *  or dot, which the route table here sees as one segment and the
     *  planner (Starlette decodes the path) as more. The host is the
     *  configured planner's whatever the path (CodeQL's java/ssrf, the
     *  path being the browser's): this keeps the path to the routes. */
    static boolean isPlain(String upstreamPath) {
        if (!upstreamPath.startsWith("/api/") && !upstreamPath.equals("/api")) {
            return false;
        }
        String lower = upstreamPath.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("//") || lower.contains("\\") || lower.contains("%2f") || lower.contains("%5c") || lower.contains("%2e")) {
            return false;
        }
        for (String segment : upstreamPath.split("/", -1)) {
            if (segment.equals(".") || segment.equals("..")) {
                return false;
            }
        }
        return true;
    }

    /** {@code /api/planner/course} upstream is {@code /api/course}. */
    private static String upstreamPath(HttpServletRequest request) {
        return "/api" + request.getRequestURI().substring("/api/planner".length());
    }

    private static String query(HttpServletRequest request) {
        String queryString = request.getQueryString();
        return queryString == null ? "" : "?" + queryString;
    }
}
