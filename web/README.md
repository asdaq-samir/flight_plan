# web/

React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + Leaflet front
end, built into `webapp`'s jar and served from `/app`. Three pages:

- `/app/plan` — the app's homepage (bare `/app` redirects here). Enter a
  departure and destination; get the charted course, scored checkpoints
  and the nav log. A Map tab and a Brief tab share one persistent
  header. Brief is the FAA-sequence briefing, with an AI narrative
  popover (LangGraph or CrewAI, each a real Claude call) and print.
- `/app/label` — walk a route's detected waypoints on the sectional and
  rate each one, producing ML training data. Also embedded live inside
  Settings' Dev Label tab (the same component, not a copy).
- `/app/settings` — Account (sign in, aircraft, filed flights -- each
  opens back on the planner or deletes) and Dev: the labeling workspace
  with the Dev ML drawer above it, the developer's console in three
  tabs -- Model (every algorithm trained, the registry, a retrain
  through Airflow), Corridors (what is collected, how far its labels
  have come, collect another) and System (which services answer, how
  fresh the FAA and weather data is, the doors into Jupyter, Airflow and
  the API docs). The header's theme toggle cycles system, light, dark.

The pages compute nothing themselves. Every course, checkpoint,
detection and nav log comes from `planning-service`; this front end
draws it and sends back writes (ratings, picks, corridor builds, filed
flights).

## Contents

- [Running it](#running-it)
- [Where it sits](#where-it-sits)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [What is deliberately not here](#what-is-deliberately-not-here)

## Running it

No native Node toolchain is used. Everything runs in `node:26-slim`, the
image `springboot-app/Dockerfile` builds the bundle with.

```bash
# from the repo root
docker compose up -d --build webapp       # full stack; pages at http://localhost:8080/app

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
`package.json`. The e2e suite runs every test at a desktop and a phone
viewport and checks what a DOM-only test cannot: nothing overflows the
page, the header controls sit where they should, the sidebar starts
closed.

`npm run dev` (Vite on port 5173) proxies `/api` to `localhost:8080`.
Inside a container that resolves to the container itself, so point the
proxy at `host.docker.internal:8080` or use the build path above.

## Where it sits

```
web/ (this folder)      the map, the keyboard, the rows
  → webapp              :8080  serves the bundle, proxies /api/planner/*, owns auth and the database
  → planning-service    :8084  sectional tiles, great-circle course, checkpoints, dead reckoning
  → model-service       :8000  scores candidate checkpoints
```

The front end never calls `planning-service` or `model-service`
directly. Every request goes through `webapp` at `/api/planner/*`
(`frameworkNarrative()` is the one exception, streaming from `webapp`'s
own `/api/comparison`), so there is one origin, one session and one set
of access rules.

## Project layout

```
e2e/layout.spec.ts       Real-browser layout tests (Playwright)
src/
  main.tsx               Entry point: one lazy route per page, basename /app
  Shell.tsx              The header / map / sidebar-panel layout every page mounts into
  components/            Shared UI
    MapDrawer.tsx          A drawer over the map area, under the header (the sidebar from the right, Dev ML from the top)
    TwoRowHeader.tsx       Route form and trailing icons on row one, tabs and tab actions on row two
    RouteForm.tsx, RouteInputGroup.tsx, AirportSearchInput.tsx   The DEP → DEST form and its Load button, shared by Plan and Label
    IconButton.tsx         An icon-only Button with its label as tooltip and accessible name; every header icon is one
    MapGuideButton.tsx     The Info popover button (Plan's ScoreLegend, Label's RatingLegend)
    SidebarToggleButton.tsx, SettingsButton.tsx, ZoomToggleButton.tsx, ThemeToggle.tsx   The header's icon buttons
    IdentPairInputs.tsx, CollapsibleSection.tsx, Footer.tsx
    ui/                    shadcn/ui primitives (components.json), stock unless a comment says why not
  lib/
    api/client.ts          Every network call, one function per endpoint
    api/types.ts           API request/response shapes
    map/leaflet.tsx        Shared Leaflet primitives: basemaps, course line, halo, markers
    map/useLeafletMap.ts   Map creation and teardown
  features/
    plan/                  PlanView.tsx (wiring), hooks/usePlanState.ts (state), format.ts (pure, tested),
                           components/: RouteMap, BuildNotice, ScoreLegend, navlog/, briefing/
    label/                 LabelView.tsx (wiring), hooks/useLabelState.ts (state, tested), logic.ts (pure, tested),
                           components/: ChartMap, FilterBar, ProgressCard, WaypointList, PointPopup, RatingLegend
    settings/              SettingsView.tsx (tab wiring), AccountTab.tsx, DevMlPanel.tsx, SignInModal.tsx
```

## Architecture

**Routing.** `main.tsx` builds a `react-router-dom` browser router with
one lazy-loaded route per page and `basename: "/app"`. Deep links and a
hard refresh work because `webapp`'s `WebMvcConfig` serves `index.html`
for any `/app/**` path that is not a real file.

**State.** Plan and Label each have one hook (`usePlanState`,
`useLabelState`) holding the page's state as a plain object alongside
its actions. Settings uses `@tanstack/react-query` directly for its
server data, plus local `useState` for forms. There is no global store.

**Layout (`Shell.tsx`).** A flex column: the page's header, then the
map or tab content, with the sidebar (nav log on Plan, waypoint list on
Label) as a right-hand `MapDrawer` that slides in over the map area,
dims the map behind it, and starts closed. Only the map area is covered:
the header stays usable above it, and Settings' Dev tab drops its Dev ML
drawer down from the top the same way. Plan and Label share
`TwoRowHeader` and the same trailing
controls — Info, Fit Route / Show Selected, the sidebar toggle, Settings
— so the two pages behave identically. Settings' Dev Label tab mounts
`LabelView` with `embedded` and places its pieces in its own `Shell`.

**Leaflet.** `lib/map/` holds everything `RouteMap` and `ChartMap`
share. Leaflet stays imperative — no React binding — except that popup
and marker content is JSX mounted into the DOM node Leaflet provides.
The FAA sectional is an ordinary tile layer served by `planning-service`
(`/api/sectional-tile/{z}/{x}/{y}.png`) over an OpenStreetMap base.

**API.** In `lib/api/client.ts`, `navlog()`, `detect()` and
`describeCheckpoints()` stream newline-delimited JSON through one
`streamNdjson()` helper; everything else is a plain JSON request. Every
planner shape in `lib/api/types.ts` is re-exported from `schema.d.ts`,
which `npm run types` generates from `planning-service/openapi.json`
(the `pre*` scripts run it before build, test, typecheck and lint), so a
field renamed in `planning-service/app/schemas.py` is a compile error
here rather than a silent `undefined`. Only the Spring Boot shapes are
still typed by hand.

**Messages.** Every info, warning and error message is a sonner toast
through `lib/usePageStatus.ts` (`usePageStatus` for a page's progress
line and error sources, `useErrorToasts` for a component's own); an
error a pilot can act on carries "Try again" as the toast's action.
Inline text is reserved for content, not status: a printed briefing's
own caveats and conclusions, an empty table's placeholder, a form
field's validation, a decision that needs a button of its own.

**Styling.** Tailwind utilities and stock shadcn components. The only
inline styles are colours computed from data (a rating, a score).

## What is deliberately not here

- No global state library. react-query owns server state; the two page
  hooks own the rest.
- No CSS beyond Tailwind and no CSS-in-JS. `components/ui/` is shadcn/ui
  copied into the repo, so it is Tailwind classes underneath.
- No React wrapper for Leaflet.
