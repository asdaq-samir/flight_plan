# web/

The React front end for `/app/plan` and `/app/label`. It draws sectional
charts, walks checkpoints and renders the nav log — and computes none of
it. Every number on screen arrives from `planning-service`.

The built bundle is not served from here. Vite writes it into
`springboot-app/src/main/resources/static/app`, so it ships inside
`webapp`'s jar and the browser gets the page and the API from one origin.

## Contents

- [Running it](#running-it)
- [Where it sits](#where-it-sits)
- [Learning this from zero](#learning-this-from-zero)
- [The file map](#the-file-map)
- [What is deliberately absent](#what-is-deliberately-absent)
- [Known rough edges](#known-rough-edges)

## Running it

There is no native Node toolchain in this project, by the same choice
that makes everything else Docker-only. Every command below runs in a
container from the repo root.

```bash
# Tests — 45 of them, no browser needed, about a second
docker run --rm -v "$PWD/web":/w -w /w node:20-slim \
  sh -c "npm ci && npx vitest run"

# Typecheck — catches renamed fields at every call site
docker run --rm -v "$PWD/web":/w -w /w node:20-slim \
  sh -c "npm ci && npx tsc --noEmit"

# Build the bundle into Spring Boot's static resources
docker run --rm -v "$PWD":/p -w /p/web node:20-slim \
  sh -c "npm ci && npx vite build"
```

Then rebuild the jar and open the pages:

```bash
docker compose up -d --build webapp planning-service
# http://localhost:8080/app/plan
# http://localhost:8080/app/label
```

`planning-service` must be up for either page to do anything: `webapp`
serves the bundle, but every course, detection and nav log comes from
the Python service behind it.

For the Vite dev server and its hot reload, see
[Known rough edges](#known-rough-edges) — it needs one change first.

## Where it sits

Four services, each with one job:

```
web/ (this folder)   the map, the keyboard, the rows
  → webapp        :8080  serves the bundle, proxies /api/planner/*, owns auth and the database
  → planning-service :8084  sectional tiles, great circles, checkpoints, dead reckoning
  → model-service :8000  scores candidate checkpoints
```

The front end never talks to `planning-service` directly. Everything goes
through `webapp` at `/api/planner/*`, which is what keeps one origin and
one session.

## Learning this from zero

This folder is a running log of a real rebuild, not a hypothetical, and
it has gone through three stages so far:

1. **The original port** — React with `zustand`, `react-router-dom` and
   one global `app.css`.
2. **A deliberate bare-minimum reset** — React and `leaflet` only, no
   router, no state library, no CSS at all. Done on purpose, as an
   exercise, not because stage one's choices were wrong.
3. **Back up to industry standard** — where it is now. Styling and
   structure brought back deliberately, each addition made because a
   specific pain showed up while living at stage two, not pre-emptively.

Stages 2 and 3 are what the rest of this section walks through.

### Rung zero — the actual starting point

```bash
npm create vite@latest web-min -- --template react-ts
cd web-min && npm install && npm run dev
```

That produces 18 files. Most are demonstration: delete `src/assets/`,
`public/`, `App.css`, `index.css`, `README.md` and the linter config, and
nine remain — `index.html`, `package.json`, `vite.config.ts`, three
generated `tsconfig` files, `.gitignore`, `src/main.tsx` and
`src/App.tsx`. Of those you have written about **32 lines**.

Learning which files are structural and which are scaffolding theatre is
most of what "minimal" means here.

Note the scaffold ships **React 19 and Vite 8**, while this folder is on
React 18 and Vite 5. Don't copy code between them without checking.

### Stage two: the bare-minimum reset

Two runtime dependencies beyond React itself: `leaflet` (the map has no
substitute) and nothing else. No client-side router, no global state
library, no CSS file.

- **Routing** was `main.tsx` checking `window.location.pathname` and
  picking a component directly — no `popstate` handling, no
  URL-normalizing redirect.
- **State** was `useLabelState`/`usePlanState` shaped like a zustand
  store (one `useState` holding the object, a `useRef` mirror for the
  async methods that need a `get()`-like read of the *current* value,
  `useCallback` per method) but without the dependency.
- **Styling** was nothing but Leaflet's own stylesheet and the handful
  of inline `style` props needed to give the map a real height to size
  into. Every colour, pill and table border that used to come from
  `app.css` was simply gone, and the look changing was the accepted
  cost of the reset.

That stage is what stage three below is a reaction to.

### Stage three: back up to industry standard

- **Tailwind, not hand-rolled `style={{...}}` objects.** The felt pain
  was real: every coloured badge (a rating, a score, a role, DEP/DEST)
  was its own inline object, repeated near-identically in both views,
  and styling-as-JS-object doesn't read like idiomatic React anywhere
  else. Set up via `@tailwindcss/vite` — one plugin line in
  `vite.config.ts`, one `@import "tailwindcss";` in `src/index.css`, no
  `tailwind.config.js` needed for what this app actually uses. Colour
  that's *data* rather than a fixed choice (`COLORS[rating]`,
  `scoreColor(score)`) still goes through inline `style` — in
  `components/Badge.tsx`, now the only place it happens — because a
  Tailwind class can't express a value computed at runtime, and that's
  a real constraint, not an oversight.
- **Full component decomposition.** `LabelView.tsx`/`PlanView.tsx` were
  ~300-line files mixing state wiring with every card's, row's and
  badge's markup by hand. Both now do nothing but wire
  `useLabelState`/`usePlanState` into small, single-purpose components —
  `RouteForm`, `FilterBar`, `WaypointList`, `CheckpointList`,
  `NavLogCard`, and so on. `Badge`, `Row`, `Card` and `Sidebar` are
  shared *because* both pages needed the identical pattern (a coloured
  pill, a clickable divided list row, a titled card, a scrollable card
  stack) once that repetition actually showed up — not a structure
  decided in advance.
- **A feature-folder layout.** `src/features/label/` and
  `src/features/plan/` each hold their own `components/`, `hooks/`, pure
  logic module and view, so each feature reads as one thing instead of
  a view file sitting flat next to its state hook and a same-level
  `components/` folder. `src/lib/` holds what isn't feature-specific
  (the API client and types, the Leaflet drawing primitives, the
  URL-param helper); `src/components/` holds shared *UI*, not shared
  infrastructure. See [The file map](#the-file-map).
- **`Shell.tsx` gave up the header/footer shape.** It's now a toolbar
  plus a flex row splitting the map from a scrollable sidebar of cards.
  The keyboard-shortcuts/rating-guide content that used to live in a
  footer is just one more collapsible card in that sidebar —
  `<header>`/`<footer>` were never load-bearing, they were only what
  the originally-ported HTML happened to use.
- **Editing moved onto the map, and the sidebar went back to reading.**
  Rating a point and changing its category used to be a card in the
  sidebar; `PointPopup.tsx` is that same editor, but as the Leaflet
  popup pinned to the selected point itself, with a real close button
  and a position above the point rather than on top of it. The sidebar
  (`WaypointList.tsx`) went back to being view-only, but stays in sync
  both ways: selecting a point on the map scrolls its row into view,
  and the arrow keys inside the list (detected via focus, since a click
  doesn't reliably move focus in every browser — Safari won't, without
  "Full Keyboard Access" — so `Row.tsx` focuses itself explicitly on
  click) walk the list's own top-to-bottom order and bring the map to
  each point in turn, the same as clicking that row would.

### The rungs, as they were felt the first time through

1. **Show something real.** Hardcode a course in `App.tsx` and render it
   as a list. No fetch, no map. You are learning JSX and `useState` and
   nothing else.

2. **Fetch from the real API.** `useEffect` plus
   `fetch("/api/planner/course?dep=C81&dest=KDLH")`. It will fail. That
   failure is the lesson: the fix is the `server.proxy` block in
   `vite.config.ts`, and now you know why that block exists instead of
   having inherited it.

3. **Add the map.** `npm install leaflet @types/leaflet`, render a
   `<div>`, and call `L.map(el)` in an effect. It will break under
   StrictMode by initialising two maps into one element. The `useRef`
   guard that fixes it is in `features/label/components/ChartMap.tsx`,
   and by then you will have earned the comment above it.

4. **Add the second page.** Write the routing yourself first: read
   `window.location.pathname` and pick a component, about ten lines.
   Only reach for `react-router-dom` once something that plain path
   check can't do actually shows up — back-button behavior, or
   navigation between the two views.

5. **Let state outgrow one component.** Stay on `useState` until you are
   threading a setter three levels down and two numbers disagree. *That*
   is when Zustand earns its place — the plain-hook versions in
   `features/label/hooks/useLabelState.ts`/`features/plan/hooks/usePlanState.ts`
   are already shaped like a store (one object, a getter-ish ref,
   methods) for exactly this reason: swapping in `create()` later is a
   small, mechanical change, not a rewrite. Adding the dependency
   because you felt the problem is the only good reason. (Not yet
   re-added here — see [stage three](#stage-three-back-up-to-industry-standard),
   which climbed rungs 6 and (partially) 4, not 5.)

6. **Style it last.** By then you know what elements exist, so real
   styling — a utility framework, or scoped CSS per view via CSS
   Modules, which Vite supports with no new dependency — beats one
   global sheet shared by both pages. This folder picked Tailwind (see
   [stage three](#stage-three-back-up-to-industry-standard)); CSS
   Modules would have addressed the same rough edge (below) for zero
   added dependencies, and is worth knowing as the alternative.

### The method, generalised

For each dependency in `package.json`, delete it and try to live without
it. You will either find you did not need it, or you will hit the exact
problem it solves. Both outcomes teach more than any explanation. This
is not rhetorical here — it is literally how this folder went stage
one → stage two (rung 6 back to rung 4) → stage three (most of rung 6
and rung 4's decomposition instinct, deliberately not rung 5's state
library, back up again).

## The file map

31 source files, organised by feature rather than by kind:

```
src/
  main.tsx            Entry: a plain path check picks the view, plus Leaflet's CSS
  index.css           One line: @import "tailwindcss"
  Shell.tsx           The structural layout both views mount into — see below
  components/         Shared UI: Card, Badge, Row, Sidebar
  lib/
    api/               client.ts (every network call), types.ts (API shapes)
    map/leaflet.tsx    Drawing primitives both maps share
    urlParams.ts       Reading/writing ?dep=&dest= without a router
  features/
    label/
      LabelView.tsx          The labeling page — wiring only
      logic.ts                Filters, ordering, roles. No DOM. (+logic.test.ts, 17 tests)
      hooks/useLabelState.ts  Labeling state, as a plain hook
      components/             RouteForm, FilterBar, ProgressCard,
                               WaypointList, PointPopup, RatingLegend, ChartMap
    plan/
      PlanView.tsx            The planner page — wiring only
      format.ts                Colours, number formatting, panel rows. No DOM.
                                (+format.test.ts, 28 tests)
      hooks/usePlanState.ts    Planning state, in three stages of very different cost
      components/              RouteForm, BuildNotice, CheckpointList,
                                NavLogCard, MapLegend, RouteMap
```

Four patterns explain the shape:

- **Feature folders, not type folders.** Everything `label/` needs sits
  inside `features/label/`; nothing outside it does. `lib/` and
  `components/` hold what's genuinely shared — infrastructure and
  generic UI respectively — not "all the hooks" or "all the components"
  filed together by kind regardless of who uses them.
- **The map's height is self-contained, not chained.** `Shell.tsx`'s
  outer element is `h-screen` (`height:100vh`), which sizes off the
  viewport directly rather than needing `html`, `body` and `#root` to
  each also carry a height — the chain the *original* port needed, and
  got wrong once: both pages drew the whole United States, because the
  CSS assumed the layout rows were children of `<body>` and React
  mounts them inside `#root`. No pure function was wrong and no test
  could have failed; it was found by looking. `flex-1 min-h-0` on the
  row splitting map and sidebar, and on the map's own wrapper, still has
  to be right for Leaflet to read a real size — smaller than before, but
  still a real constraint, not decoration.
- **Decisions are separated from drawing.** `logic.ts` and `format.ts`
  hold everything that can be wrong in a way a test should catch, which
  is why 45 tests run in under a second with no browser.
- **Leaflet stays imperative.** No React binding library, and nothing
  in `lib/map/leaflet.tsx` reads React state. Content is the one
  exception: tooltips, popups and marker icons are JSX mounted into a
  throwaway div (`mountReact`, in that same file) rather than built as
  HTML strings, so a label is still real React, not markup wrangled
  through template literals. The labeler's selection popup (rating
  buttons, category select, all in `PointPopup.tsx`) uses the same
  mechanism, plus `updateHaloContent` to patch that popup's content in
  place when the same point is still selected — swapping `bindTooltip`
  for `bindPopup` meant a rebuild-happy effect would otherwise tear the
  whole thing down and reopen it on every detection block streamed in.

## What is deliberately absent

- **No client-side router.** `main.tsx` picks a view from
  `location.pathname` directly.
- **No global state library.** `useLabelState`/`usePlanState` are plain
  hooks, not `zustand` stores.
- **No CSS beyond Tailwind's utilities.** No component library on top
  of it, no CSS-in-JS, no hand-written selectors — every colour that
  isn't computed from data (see [stage three](#stage-three-back-up-to-industry-standard))
  is a class, not a rule in a stylesheet.
- **No ESLint.** `lint` is `tsc --noEmit`; strict TypeScript with
  `noUncheckedIndexedAccess` catches more here than a style linter would.
- **No data-fetching library.** Two state hooks and `fetch` are enough
  for three endpoints.

## Known rough edges

**The dev server's proxy assumes a native Node install.**
`vite.config.ts` proxies `/api` to `http://localhost:8080`. Run
`npm run dev` in a container and `localhost` is the container, not your
Mac, so every API call fails. Either point the target at
`http://host.docker.internal:8080` first, or skip the dev server and use
`vite build` plus `docker compose up --build webapp`, which is slower but
matches production exactly.

**`tsconfig.tsbuildinfo` is tracked.** It is a TypeScript build cache and
`.gitignore` lists only `node_modules/` and `dist/`. It should be ignored.

**No responsive breakpoints.** `Sidebar`'s `w-80` is a fixed width
regardless of viewport size — on a narrow window the map gets whatever
space is left over, down to none. Tailwind makes `sm:`/`md:` variants
cheap to add later; nothing has needed them yet because this runs in a
full browser window, not a phone.

**`NavLogCard`'s table uses the legacy `cellPadding` HTML attribute**
rather than a Tailwind padding class repeated across twelve columns'
worth of `<td>`/`<th>`. It's the one spot styling isn't a Tailwind
class — worth revisiting if the table grows another reason to change.

**A click doesn't reliably focus a plain clickable element — fixed.**
`WaypointList`'s rows need real keyboard focus for the labeler to tell
"arrows should walk this list" apart from "arrows should walk the map"
(see [stage three](#stage-three-back-up-to-industry-standard)), and a
`tabIndex` alone wasn't enough: Safari doesn't move focus on click for
anything that isn't a native form control unless "Full Keyboard
Access" is on. `Row.tsx`'s click handler calls `.focus()` on itself
explicitly rather than trusting the browser default. Caught by running
the same interaction under WebKit, not just Chromium.

**Two real bugs in `webapp` were found through this folder, not fixed
in it.** Rating a point (or deleting one, or starting a build) was
silently failing before this round added a UI that actually exercised
those write paths end to end for the first time — a missing
`XSRF-TOKEN` cookie, and the planner proxy's `HttpClient` corrupting
POST bodies by attempting an HTTP/2 upgrade against an HTTP/1.1-only
server. Both are documented and fixed in
[`springboot-app/README.md`](../springboot-app/README.md#things-that-are-not-obvious),
not here, since neither is a front-end fault.
