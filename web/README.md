# web/

React 19 + Vite 8 + Tailwind v4 + Leaflet front end for three pages:

- `/app/plan` — the app's own homepage (bare `/app` redirects here):
  enter a departure/destination, get a charted course, scored
  checkpoints, a dead-reckoning nav log, and a printable Flight
  Briefing. Its own header row folds the site header and the route
  form into one line (route form + a Settings gear icon), not two --
  see PlanView's own comment.
- `/app/label` — walk a route's detected waypoints on a sectional chart
  and rate each one (ML training data). Linked from Settings rather
  than its own header link.
- `/app/settings` — everything that isn't the map: what the app does,
  the stateless "explore how this project works" demos (every trained
  algorithm's accuracy side by side, live scoring, the full reasoning
  behind a recommended cruise altitude -- no sign-in needed for any of
  that), then a signed-in pilot's own aeroplanes and filed flights.
  One page behind the header's own gear icon, not three behind three
  separate nav items.

Plan/Label compute nothing themselves — every course, checkpoint,
detection and nav log comes from `planning-service`; this front end
only draws it and sends back writes (ratings, added picks, corridor-build
requests, filed flights).

## Contents

- [Quick start](#quick-start)
- [Where it sits](#where-it-sits)
- [Project layout](#project-layout)
- [Commands](#commands)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [What's intentionally not here](#whats-intentionally-not-here)

## Quick start

No native Node toolchain is used — everything runs in Docker.

```bash
# from the repo root

# install deps + typecheck + unit tests
docker run --rm -v "$PWD/web":/w -w /w node:26-slim sh -c "npm ci && npx tsc --noEmit && npx vitest run"

# build the bundle into Spring Boot's static resources
docker run --rm -v "$PWD":/p -w /p/web node:26-slim sh -c "npm ci && npx vite build"

# bring up the full stack and open the pages
docker compose up -d --build webapp
# http://localhost:8080/app/plan
# http://localhost:8080/app/label
# http://localhost:8080/app/settings
```

`webapp` serves the static bundle and proxies `/api/planner/*`; Compose
brings up `planning-service` with it so the app's planner routes have
their backing API.

## Where it sits

```
web/ (this folder)   the map, the keyboard, the rows
  → webapp            :8080  serves the bundle, proxies /api/planner/*, owns auth + the database
  → planning-service  :8084  sectional tiles, great-circle course, checkpoints, dead reckoning
  → model-service      :8000  scores candidate checkpoints
```

The front end never calls `planning-service` or `model-service`
directly — every request goes through `webapp` at `/api/planner/*`, so
there is one origin, one session, and one set of access rules.

## Project layout

```
playwright.config.ts     Playwright config for e2e/
e2e/layout.spec.ts       Real-browser layout tests (see Commands)
src/
  main.tsx                Entry point: routes /app/plan, /app/label and /app/settings
  index.css               @import "tailwindcss" + a few global resets
  Shell.tsx               Full-screen layout the app's routes mount into
  components/             Shared UI
    Card.tsx, Badge.tsx, Row.tsx      Titled container, colour pill, clickable list row
    Sidebar.tsx                       Draggable right-hand panel
    CollapsibleToolbar.tsx            Draggable top drawer
    PullTab.tsx                       The grip-capsule handle both drag controls show
    MapActionButton.tsx               Bottom-left floating action button
    GuidePanel.tsx                    Bottom-right button + reference panel
    Key.tsx                           Styled keyboard-shortcut badge
  lib/
    api/client.ts          Every network call, one place
    api/types.ts            API request/response shapes
    map/leaflet.tsx          Shared Leaflet drawing primitives (course line, halo, markers)
    map/useLeafletMap.ts     Shared map-creation/teardown hook
  features/
    label/
      LabelView.tsx                    Page: wiring only
      logic.ts                         Pure filter/order/role logic (+ logic.test.ts)
      hooks/useLabelState.ts           All label-page state (+ useLabelState.test.ts)
      components/
        ChartMap.tsx                   The Leaflet map (imperative, no React state)
        RouteForm.tsx, FilterBar.tsx    Dep/dest input, visibility checkboxes
        ProgressCard.tsx, WaypointList.tsx   Rated-count summary, the walk list
        PointPopup.tsx                 Rating/category editor, pinned to the selected point
        RatingLegend.tsx               Guide content: rating scale + shortcuts
    plan/
      PlanView.tsx                     Page: wiring only
      format.ts                        Pure colour/number/row formatting (+ format.test.ts)
      hooks/usePlanState.ts            All plan-page state
      components/
        RouteMap.tsx                   The Leaflet map (imperative, no React state)
        RouteForm.tsx, BuildNotice.tsx  Dep/dest/altitude input, corridor-build banner
        CheckpointList.tsx             The scored-checkpoint list
        NavLogView.tsx                 Full-screen nav log table (replaces the map view)
        NavLogActions.tsx              Map/print icon buttons for the nav log view
        ScoreLegend.tsx                Guide content: checkpoint score key + shortcuts
    settings/
      SettingsView.tsx                 Page: project demos, sign-in, aircraft and flights
      SignInModal.tsx                  Email / Google / Apple sign-in dialog
```

## Commands

All of these run inside `node:26-slim`; mount `web/` at `/w` (or the
repo root at `/p` for the build, since Vite writes outside `web/`).

| Purpose | Command |
|---|---|
| Install deps | `npm ci` |
| Typecheck | `npx tsc --noEmit` |
| Unit tests (jsdom, ~52 tests) | `npx vitest run` |
| Build | `npx vite build` (writes to `../springboot-app/src/main/resources/static/app`) |
| Dev server | `npx vite --host 0.0.0.0` (port 5173) |
| E2E / layout tests | see below |

**E2E tests** need the app actually running (`docker compose up -d
--build webapp` first) and a real browser — they
check things a DOM-only test can't see, like whether an element is
really flush against a screen edge or a collapsed panel is really
zero width:

```bash
docker run --rm --network host -v "$PWD/web":/w -w /w \
  mcr.microsoft.com/playwright:v1.55.1-jammy sh -c "npm ci && npx playwright test"
```

The image tag's version must match `@playwright/test`'s version in
`package.json`. `BASE_URL` env var overrides the default
`http://localhost:8080`.

**Dev server note:** `vite.config.ts` proxies `/api` to
`http://localhost:8080`. Running the dev server in a container means
`localhost` resolves to the container, not the host — point the proxy
target at `host.docker.internal:8080` instead, or skip the dev server
and use `vite build` + `docker compose up --build webapp`.

## Architecture

**Routing.** `main.tsx` builds a `react-router-dom` `createBrowserRouter`
with one lazy-loaded route per page (Plan/Label/Settings), Plan
also being the index route, `basename: "/app"` matching where `webapp`
serves the bundle. Deep links
and a hard refresh both work without any change on the Spring Boot
side — `WebMvcConfig`'s resource resolver already falls back to
`index.html` for any path under `/app/**` that isn't a real file.

**State.** Each page has one hook (`useLabelState` / `usePlanState`)
holding all of that page's state as a plain object, returned alongside
its action methods. No global state library; each hook is local to its
page's view component.

**Layout (`Shell.tsx`).** The map fills the entire viewport
(`relative h-dvh w-full`). Everything else — the toolbar, the sidebar,
floating buttons, error banners — is `position: absolute`, layered on
top of the map via `z-index`, not laid out in a flex row that shares
space with it.

- `CollapsibleToolbar` floats across the top; drag its tab down to
  reveal the route form. Its max drag height is measured live off its
  own content (`ResizeObserver`), not a fixed number.
- `Sidebar` floats down the right edge; drag its tab left to reveal
  the checkpoint/waypoint list. Its max width scales with the
  viewport (up to 70%).
- Both start collapsed (width/height 0) on every load. Both report
  their current size via an `onWidthChange`/`onHeightChange` callback
  prop, and both are real `role="slider"` elements — Tab to focus,
  arrow keys to resize, Home/End to jump fully closed/open.
- `MapActionButton` (bottom-left) is a page's one primary action:
  Start/Resume/Fit-line on the label page, the map/nav-log switch on
  the plan page's map view.
- `GuidePanel` (bottom-right) opens a reference panel — the rating
  scale on the label page, the checkpoint score key on the plan page.
  It hides itself while its page's sidebar is pulled open, since both
  live in the same corner.
- On the plan page, switching to the nav log view (`NavLogView`)
  replaces the map, sidebar and toolbar entirely and shows its own
  `NavLogActions` pair (map icon to go back, print icon for
  `window.print()`) top-right instead.

**Leaflet.** `lib/map/leaflet.tsx` and `useLeafletMap.ts` hold every
drawing primitive both `ChartMap` and `RouteMap` share (course line,
selection halo, markers, basemap toggle, map creation/teardown).
Leaflet stays fully imperative — no React binding library — except
that popup/tooltip/marker content is JSX mounted into the DOM node
Leaflet gives it (`mountReact`), not built as HTML strings.

**API.** `lib/api/client.ts` is every network call the app makes, one
function per endpoint, all under `/api/planner/*`. `detect()` streams
newline-delimited JSON for live detection progress; everything else is
a plain JSON request/response.

**Styling.** Tailwind utility classes throughout; the only inline
`style` values are colours computed from data (a rating, a score) that
a static class can't express (`Badge`).

## Deployment

`vite build` writes into
`springboot-app/src/main/resources/static/app`, so the bundle ships
inside `webapp`'s jar — the page and its API arrive from one origin.
`web/Dockerfile` builds this as the first stage of `webapp`'s own
image (`docker/Dockerfile` in `springboot-app/`); there's no separate
container for this front end in production.

## What's intentionally not here

- No global state library (`zustand`/Redux/etc.) — `@tanstack/react-query`
  (see below) owns server-cache state; there's no separate client-side
  app state that needs one
- No CSS beyond Tailwind's utilities — no CSS-in-JS, no component
  library (`clsx` just composes class strings, it doesn't generate
  styles)
