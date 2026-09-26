# web/

React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + Leaflet front
end, built into `webapp`'s jar and served from `/app`. Two pages, one
component (`MapPage`) in two modes:

- `/app/plan` — the pilot's page, and the app's own homepage (`/app`
  redirects here). Enter a departure and destination; get the charted
  course, scored checkpoints and the nav log, in a drawer beside the
  map. Every checkpoint, the two airports and every Class B airport
  (off by default; the layers popover switches it on) are markers on
  the chart — tap one to go to it and open its card, tap the chart to
  put the card away. The altitude row in the nav log's header opens
  the planner's own reasoning and its three plans (lowest, highest,
  fastest for the winds), one tap to fly another, or a custom
  altitude. A departure time gives every row an ETA, picks the winds
  forecast the legs are flown on, and sets the fuel reserve (30
  minutes by day, 45 at night) the fuel check holds the tanks against.
  Printed, the log is a landscape page with blank ATA and
  fuel-remaining columns to fill in in flight. Opened wide
  (`?view=briefing`, or the sidebar toggle), the same drawer is the
  FAA-sequence briefing: the nav log with the briefing's sections
  under it, an AI narrative popover (LangGraph or CrewAI, each a real
  Claude call) and Print in its header, the map still beside it. The
  pilot console drops down over the map from the header: sign-in, the
  pilot's own aeroplanes (the nav log flies the one picked), filed
  flights and the theme.
- `/app/dev` — the developer's page: walk a route's detected waypoints
  on the sectional and rate each one, producing ML training data, with
  the dev console dropping down over the chart in tabs — Model
  Training (collect a corridor, ratings so far, retrain through
  Airflow), Performance (every algorithm trained, the promoted one)
  and System (which services answer, how fresh the FAA and weather
  data is, the doors into Jupyter, Airflow and the two agents — each a
  link that starts the container if it isn't running). `/app/label`
  redirects here (its own query string carried over); `/app/settings`
  redirects to Plan, where everything it used to hold now lives in the
  pilot console.

Both pages are one `MapPage` component (`features/page/MapPage.tsx`)
around a different `WorkspacePieces` (`features/page/workspace.ts`):
the workspace owns its own data and hands back a map, a sidebar, a
console and a submit action; the page owns the shell around them — the
header, the sidebar panel, the console sheet — so the two pages cannot
drift in where a control sits or how a drawer opens, only in what they
hold.

The pages compute nothing themselves. Every course, checkpoint,
detection and nav log comes from `planning-service`; this front end
draws it and sends back writes (ratings, picks, corridor builds, filed
flights, checkpoint notes).

## Contents

- [Running it](#running-it)
- [Where it sits](#where-it-sits)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Maps](#maps)
- [What is deliberately not here](#what-is-deliberately-not-here)

## Running it

No native Node toolchain is used. Everything runs in `node:26-slim`, the
image `springboot-app/Dockerfile` builds the bundle with.

```bash
# from the repo root
docker compose up -d --build --wait webapp   # full stack; returns once the pages answer (webapp's healthcheck)

# typecheck, lint and unit tests
docker run --rm -v "$PWD/web":/w -w /w node:26-slim \
  sh -c "npm ci && npm run types && npx tsc -b && npx eslint . && npx vitest run"

# real-browser layout tests, against the running stack
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/web":/w -w /w \
  -e BASE_URL=http://host.docker.internal:8080 \
  mcr.microsoft.com/playwright:v1.55.1-noble sh -c "npm ci && npx playwright test"
```

`vite build` writes into `springboot-app/src/main/resources/static/app`
(`vite.config.ts`) for a local `mvn package`; the Docker image builds
the bundle in its own stage and serves it from a directory beside the
jar (`APP_STATIC_LOCATION`, see `WebMvcConfig`), so the page and its API
still come from one origin and a front-end change rebuilds only that
stage. There is no separate front-end container; `docker compose up
--build webapp` rebuilds the bundle.

The Playwright image tag must match `@playwright/test`'s version in
`package.json`. The e2e suite (`e2e/*.spec.ts`) runs every test at a
desktop and a phone viewport and checks what a DOM-only test cannot:
nothing overflows the page, the header controls sit where they should,
a popup on the map is dismissed the same way on every marker, a toast
survives a drawer opening under it.

`npm run dev` (Vite on port 5173) proxies `/api` to `localhost:8080`.
Inside a container that resolves to the container itself, so point the
proxy at `host.docker.internal:8080` or use the build path above.

## Where it sits

```
web/ (this folder)      the map, the header, the drawers
  → webapp              :8080  serves the bundle, proxies /api/planner/*, owns auth and the database
  → planning-service    :8084  sectional tiles, great-circle course, checkpoints, dead reckoning, Class B weather
  → model-service       :8000  scores candidate checkpoints
```

The front end never calls `planning-service` or `model-service`
directly. Every request goes through `webapp` at `/api/planner/*` (a
middleware rewrites `/api/x` to that path, so call sites read as if
they spoke to the planner directly), so there is one origin, one
session and one set of access rules. The one exception is the AI
narrative, streamed from `webapp`'s own `/api/comparison`.

## Project layout

```
e2e/*.spec.ts             Real-browser tests (Playwright): layout, toasts, Class B
src/
  main.tsx                Entry point: route table (basename /app), the course prefetched before React mounts
  index.css                Leaflet popup/tooltip theming, print rules, the count-flash keyframe
  components/              Shared UI, one level above any single page
    IconButton.tsx           Every icon-only button: a stock shadcn Button + Tooltip + accessible name, one size
    RouteForm.tsx, AirportPicker.tsx                                      The route form both pages share
    MapControls.tsx          The map's own corner stack: the layers popover, the zoom toggle, full screen
    ChartLayers.tsx           The layers popover's contents: base chart, TAC pin, Class B, marker zoom
    ConsoleTabs.tsx, KeepRoute.tsx, SelectableRows.tsx
    ui/                      shadcn/ui primitives (components.json), stock unless a comment says why not
  lib/
    api/client.ts             Every network call, one function per endpoint
    api/types.ts               API request/response shapes, re-exported from schema.d.ts and webapp-schema.d.ts
    map/                       Everything the two maps share (see Maps, below)
    preferences.ts             What's remembered per browser (zustand + localStorage): charts, aeroplane, filters
    queryClient.ts             The react-query client; a failed query becomes one toast, keyed by its message
  features/
    page/MapPage.tsx, workspace.ts   The shell both pages mount into, and the contract a workspace hands it
    plan/PlanWorkspace.tsx           The pilot's workspace: hooks/usePlan.ts (state), components/: RouteMap,
                                      BuildNotice, AltitudeReasoning, navlog/, briefing/
    train/TrainWorkspace.tsx         The developer's workspace: hooks/useTraining.ts (state), logic.ts (pure,
                                      tested), components/: ChartMap, WaypointPanel, PointPopup, FilterBar
    pilot/PilotPanel.tsx             The pilot console: AccountPanels.tsx (sign-in, aircraft, flights), SignInModal.tsx
    dev/DevPanel.tsx, DevButton.tsx  The dev console (its own chunk — see Architecture) and the header button that opens it
```

## Architecture

**Routing.** `main.tsx` builds a `react-router-dom` browser router with
one lazy-loaded route per page and `basename: "/app"`. Deep links and a
hard refresh work because `webapp`'s `WebMvcConfig` serves `index.html`
for any `/app/**` path that is not a real file.

**Code-splitting.** The developer's console (`DevPanel`, recharts and
the model tables) and the whole training workspace (`TrainWorkspace`)
are `React.lazy`, so a pilot loading `/app/plan` never pays for either
— importing `DevButton` used to pull the console in by accident, since
it lived in the same module `DevPanel` did. The nav log's calendar
popover (`react-day-picker`, one component behind one button) is lazy
the same way. Leaflet's div-icon markers (`lib/map/icons.ts`) are built
from template strings rather than JSX rendered with
`renderToStaticMarkup`, which otherwise pulled the whole of
`react-dom/server` into every page's chunk for four spans. Together
these took the planner's cold-load JavaScript from 1.67 MB to 1.00 MB.

**Cold load.** `main.tsx` asks the planner for the course named in the
address (`prefetchQuery`, the same query key and fetcher `usePlan`
uses) *before* `ReactDOM.createRoot(...).render(...)` runs — React
mounting, the router resolving and the workspace rendering all used to
happen first, with the request queued behind them for a route the URL
had already named. The component then finds the answer already in
`react-query`'s cache instead of asking again.

**State.** Plan and Train each have one hook (`usePlan`, `useTraining`)
holding the page's state as a plain object alongside its actions.
`react-query` owns server data everywhere (cached, with its own
retry/error handling); `zustand` (`lib/preferences.ts`) owns what's
remembered per browser; there is no other global store.

**API.** `lib/api/client.ts` is built on `openapi-fetch`, typed end to
end from each server's own OpenAPI document: `planning-service`'s
(`schema.d.ts`) and the Spring Boot app's (`webapp-schema.d.ts`, from
`springboot-app/openapi.json`), both generated by `npm run types`, which
the `pre*` scripts run before build, test, typecheck and lint. A field
renamed in `planning-service/app/schemas.py` or in a Java DTO is a
compile error here, not a silent `undefined`; both committed documents
are checked against the running code by their own service's tests.
`navlog()`, `detect()` and the checkpoint-notes stream read
newline-delimited JSON one line at a time. The CSRF header and the
`ApiError` for a failed response are one middleware both clients use;
the only plain `fetch`es are Spring Security's own `/logout` and the
narrative the webapp forwards to an agent untouched, and they call the
same two helpers.

**Messages.** Every info, warning and error is a sonner toast, centred
and full-width (`main.tsx`'s `Toaster` props), at most three stacked at
once. A failed query becomes one toast keyed by its own message
(`queryClient.ts`) rather than by the query's hash — three queries
failing the same way used to stack three identical toasts. Its own
"Try again" refetches every query currently in error, not just the one
that happened to toast last. Toasts have `pointer-events: none` on
their container with `auto` restored on the toast itself
(`index.css`), so the map keeps taking wheel/drag events with one on
screen, and Radix's `onInteractOutside` (`components/ui/sheet.tsx`) is
told to ignore a click inside the toaster, so closing a toast never
closes the drawer under it.

**Styling.** Tailwind utilities and stock shadcn components. The only
inline styles are colours computed from data (a rating, a flight
category, a score) and CSS custom properties Leaflet itself reads.

## Maps

`lib/map/` is everything the planner's route map (`RouteMap.tsx`) and
the training map (`ChartMap.tsx`) share, under `MapShell` — the
container, the chart tiles, the fit-to-route, own ship, Class B, and
the corner controls. Neither map talks to Leaflet directly.

**One card, three shapes it fills.** Every marker's popup — a
checkpoint, an airport, a Class B field, a training point — is a
`MapCard`: a title, an optional subtitle, an optional `leading` control
(the Class B card's terminal-chart pin) and children. It sizes to its
own content (`w-max`) up to a cap, and never narrower than the box
Leaflet gives it (`min-w-full`) — a Leaflet *popup* writes a width onto
its content box down to a `minWidth` floor, so a short card measured
against `w-max` alone sat 89px wide inside a 220px box, with 15px of
space on one side and 147 on the other; a Leaflet *tooltip* instead
shrink-wraps its content, which is what `w-max` is for (without it, a
raw METAR wrapped every four words). `MapPopup` and `MapTooltip` are
the shared `<Popup>`/`<Tooltip>` wrappers underneath, carrying the one
set of defaults every card used to set for itself, differently, at
three call sites — including Leaflet's own close button, which is off
everywhere (`closeButton={false}`): there is no close button on a
card. A tap on the chart puts a card away — Leaflet's own
`closeOnClick` — the same way tapping a map already does everywhere
else, and it is what closes two of the three cards without any code
here at all.

**A tap goes to the marker.** Every marker — checkpoint, airport,
Class B field, training point — answers a tap the same way: select it,
fly the map to it, open its card. This used to be three different
answers (the planner's checkpoints flew and opened nothing, the
training points selected without moving, Class B opened a card and
left zooming to an icon inside it); unifying it retired the Class B
card's own zoom button, since the tap that opens the card has already
gone there.

**Zoom state.** `useZoomLevel` reads the map's real zoom
(`react-leaflet`'s `useMapEvents`) for anything drawn only once zoomed
in — a route's checkpoints, the training map's crowd of detections.
Every `useMapEvents` call site in this codebase memoizes its handlers
object: react-leaflet lists it in the underlying effect's own
dependencies, so a handlers object literal is detached and
re-registered on *every render*, and a Leaflet event fired inside that
render is lost. That is not theoretical — it is what made the map's
own zoom toggle (`MapShell`'s `FitReporter`) report the wrong state
after its first press, since the map's own zoom change and the
listener's re-registration raced on every commit. The toggle itself
compares the map's real zoom against `getBoundsZoom(bounds)` — what
zoom would fit the route, with the same padding the fit uses — rather
than a fixed number, so it works the same on a ten-mile hop and a
transcontinental leg.

**Fitting the route** happens once per route (`MapShell`, keyed on the
two idents, not on the `bounds` object) rather than once per render of
`bounds` — the course is a `react-query` query, it can be answered
again (a retry, the same route asked for twice), and each answer is a
new object; fitting on every one of those snapped the map back to the
whole route from wherever a pilot had navigated to, seconds after a
tap.

## What is deliberately not here

- No global state library beyond `zustand`'s one small preferences
  store. `react-query` owns server state; the two workspace hooks own
  the rest.
- No CSS beyond Tailwind and no CSS-in-JS. `components/ui/` is
  shadcn/ui copied into the repo, so it is Tailwind classes underneath.
- No React wrapper for Leaflet, and no `React.memo` reached for before
  a measured render cost justified it — the one real render bug this
  session found (stale `useMapEvents` handlers losing events) was a
  listener-registration bug, not a missing memo, and memoizing
  components around it would have fixed nothing.
