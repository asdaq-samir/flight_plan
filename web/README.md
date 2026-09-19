# web/

React 19 + Vite 8 + Tailwind v4 + Leaflet front end for three pages:

- `/app/plan` — the app's own homepage (bare `/app` redirects here):
  enter a departure/destination, get a charted course and scored
  checkpoints. One persistent two-row header (route form + Settings
  gear on row one, a Map/Brief tab pair + whichever trailing actions
  belong to the active tab on row two) — Map is the charted course and
  nav log sidebar; Brief is the FAA-sequence weather/NOTAM briefing,
  with an AI popover (LangGraph and CrewAI tabs, each a real billed
  Claude call) and a print button. Switching tabs never remounts the
  header, so it never reads as leaving the page.
- `/app/label` — walk a route's detected waypoints on a sectional chart
  and rate each one (ML training data). Reachable two ways: standalone
  at this URL, or embedded live inside Settings' own Dev Label tab
  (the identical component, not a second copy — see that tab's own
  comment in `SettingsView.tsx`).
- `/app/settings` — three tabs behind the header's own gear icon, not
  three separate nav items: Account (sign in, your aeroplanes, your
  filed flights), Dev ML (the stateless "explore how this project
  works" demos — model comparison, algorithm picker — no sign-in
  needed for either), and Dev Label (the Label page above, embedded).

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
docker compose up -d --build webapp planning-service
# http://localhost:8080/app/plan
# http://localhost:8080/app/label
# http://localhost:8080/app/settings
```

`planning-service` must be running for any of these to do anything —
`webapp` only serves the static bundle and proxies `/api/planner/*`.

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
  main.tsx                Entry point: one lazy route each for Plan/Label/Settings
  index.css               @import "tailwindcss" + a few global resets
  Shell.tsx               The header/map/sidebar layout every page mounts into
  components/             Shared UI
    TwoRowHeader.tsx                  Route-form-or-tabs row + tabs-and-actions row (Plan, Settings)
    MapGuideButton.tsx                The "i" reference-popover button (Plan's ScoreLegend, Label's RatingLegend)
    SettingsButton.tsx                The gear icon every header but Settings' own ends in
    IdentPairInputs.tsx               The DEP -> DEST input pair, everywhere a route is entered
    CollapsibleSection.tsx            <details>-based section used throughout Settings/Brief
    Footer.tsx                        The small links line at the bottom of Settings
    ui/                               shadcn/ui primitives (button, dialog, popover, select,
                                       sheet, sidebar, tabs, table, tooltip, etc.) -- see
                                       components.json; not hand-rolled
  lib/
    api/client.ts          Every network call, one place
    api/types.ts            API request/response shapes
    map/leaflet.tsx          Shared Leaflet drawing primitives (course line, halo, markers)
    map/useLeafletMap.ts     Shared map-creation/teardown hook
  features/
    label/
      LabelView.tsx                    Page: wiring only. Takes an `embedded` prop + a render-prop
                                        `children` -- standalone renders its own Shell; embedded
                                        (Settings' own Dev Label tab) hands its pieces (route form,
                                        guide button, map, sidebar) to the caller's own Shell instead
      logic.ts                         Pure filter/order/role logic (+ logic.test.ts)
      hooks/useLabelState.ts           All label-page state (+ useLabelState.test.ts)
      components/
        ChartMap.tsx                   The Leaflet map (imperative, no React state)
        RouteForm.tsx, FilterBar.tsx    Dep/dest input + Start/Resume/Fit-line button, visibility checkboxes
        ProgressCard.tsx, WaypointList.tsx   Rated-count summary, the walk list
        PointPopup.tsx                 Rating/category editor, pinned to the selected point
        RatingLegend.tsx               Guide content: rating scale + shortcuts
    plan/
      PlanView.tsx                     Page: wiring only, owns the Map/Brief tab state
      format.ts                        Pure colour/number/row formatting (+ format.test.ts)
      hooks/usePlanState.ts            All plan-page state, including the LangGraph/CrewAI narratives
      components/
        RouteMap.tsx                   The Leaflet map (imperative, no React state) -- the Map tab
        RouteForm.tsx, BuildNotice.tsx  Dep/dest/altitude input, corridor-build banner
        ScoreLegend.tsx                Guide content: checkpoint score key + shortcuts
        navlog/
          NavLogView.tsx               The nav log table, in the sidebar
          NavLogActions.tsx            The AI-popover + print buttons -- the Brief tab's own trailing actions
        briefing/
          FlightBriefingView.tsx       The Brief tab's own content: FAA-sequence briefing + nav log
    settings/
      SettingsView.tsx                 Page: Account / Dev ML / Dev Label tabs, each its own Shell
      SignInModal.tsx                  The three-provider (Google/Apple/email) sign-in dialog
```

## Commands

All of these run inside `node:26-slim`; mount `web/` at `/w` (or the
repo root at `/p` for the build, since Vite writes outside `web/`).

| Purpose | Command |
|---|---|
| Install deps | `npm ci` |
| Typecheck | `npx tsc --noEmit` |
| Unit tests (jsdom, 46 tests) | `npx vitest run` |
| Build | `npx vite build` (writes to `../springboot-app/src/main/resources/static/app`) |
| Dev server | `npx vite --host 0.0.0.0` (port 5173) |
| E2E / layout tests | see below |

**E2E tests** need the app actually running (`docker compose up -d
--build webapp planning-service` first) and a real browser — they
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

**State.** Plan and Label each have one hook (`usePlanState` /
`useLabelState`) holding all of that page's state as a plain object,
returned alongside its action methods, local to its own view
component. Settings has no equivalent hook — its own data
(`pilot`/`aircraft`/`flights`, each Dev ML panel's own one-off
lookup) is server-cache state through `@tanstack/react-query` directly
(`useQuery`/`useMutation`), plus a little local `useState` for form
inputs and which tab is active. No global state library either way.

**Layout (`Shell.tsx`).** A real flex column, not an absolutely-
positioned map with everything else layered on top of it: a `header`
(whatever the page passes in — see `TwoRowHeader` below) sits above a
`flex-1` region holding the map/content, with an optional shadcn
`Sidebar` pushed in from the right (`SidebarProvider`/`SidebarInset`,
off-canvas and closed by default, a slide-over `Sheet` below its own
mobile breakpoint). `sidebar={null}` hides it (and its trigger)
entirely, the shape Settings' own Account/Dev ML tabs use.

- `TwoRowHeader` is Plan's and Settings' own shared header shape: row
  one is a route form (Dev Label's own, on Settings) plus a trailing
  icon (Settings gear on Plan, a Map icon on Settings); row two is a
  `Tabs`/`TabsList` pair (Map/Brief on Plan; Account/Dev ML/Dev
  Label on Settings) plus whichever actions belong to the active tab.
  Label's own standalone header is a single row instead — a route
  form plus a trailing icon group — since it has no tabs of its own.
- The `Sidebar`'s own toggle (`SidebarTrigger`) and each page's own
  reference-popover button (`MapGuideButton` — Plan's `ScoreLegend`,
  Label's `RatingLegend`) sit inline in the header now, next to each
  other, on every current page (`sidebarTriggerFloating={false}`,
  `floating={false}`) — `Shell`'s own default still floats both
  bottom-corner, over the map, for a future caller that wants that
  instead of a header slot.
- On the plan page, the Brief tab (`FlightBriefingView`) replaces the
  map in Shell's own `map` slot, not the whole page — the same header
  stays up, with `NavLogActions` (the AI popover, then print) as row
  two's own trailing content instead of the guide button/sidebar
  trigger pair Map uses.
- Settings' own Dev Label tab embeds `LabelView` (passed `embedded`
  and a render-prop `children`) directly into a second `Shell`
  instance's `header`/`map`/`sidebar` slots, so its `SidebarTrigger`
  resolves against the same `SidebarProvider` its own map/sidebar
  render into — real, live, interactive, not a link to `/app/label`.

**Leaflet.** `lib/map/leaflet.tsx` and `useLeafletMap.ts` hold every
drawing primitive both `ChartMap` and `RouteMap` share (course line,
selection halo, markers, basemap toggle, map creation/teardown).
Leaflet stays fully imperative — no React binding library — except
that popup/tooltip/marker content is JSX mounted into the DOM node
Leaflet gives it (`mountReact`), not built as HTML strings.

**API.** `lib/api/client.ts` is every network call the app makes, one
function per endpoint, almost all under `/api/planner/*` — the one
exception is `frameworkComparison()`, which calls `webapp`'s own
`/api/comparison` directly (that's `ComparisonProxyController`, not the
Python planner). `navlog()`, `detect()` and `describeCheckpoints()`
all stream newline-delimited JSON, one message at a time, through a
shared `streamNdjson()` helper; everything else is a plain JSON
request/response.

**Styling.** Tailwind utility classes throughout; the only inline
`style` values are colours computed from data (a rating, a score) that
a static class can't express (shadcn's `Badge`).

## Deployment

`vite build` writes into
`springboot-app/src/main/resources/static/app`, so the bundle ships
inside `webapp`'s jar — the page and its API arrive from one origin.
`springboot-app/Dockerfile`'s own first stage builds this directly
(`FROM node:26-slim AS web`); there's no separate container for this
front end in production.

## What's intentionally not here

- No global state library (`zustand`/Redux/etc.) — `@tanstack/react-query`
  (see below) owns server-cache state; there's no separate client-side
  app state that needs one
- No CSS beyond Tailwind's utilities, and no CSS-in-JS — `components/ui/`
  is shadcn/ui, copied into this repo (`components.json`) rather than an
  installed package with its own runtime styling engine, so it's still
  just Tailwind classes underneath; `clsx`/`cn` only compose class
  strings, they don't generate styles
