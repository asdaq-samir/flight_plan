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

If you want to understand this folder by rebuilding it rather than
reading it, here is the path. Every rung runs, and every rung ends with a
problem you can feel before you solve it — which is the point.

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

### The six rungs

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
   guard that fixes it is in `chart/ChartMap.tsx`, and by then you will
   have earned the comment above it.

4. **Add the second page.** Write the routing yourself first: read
   `window.location.pathname` and pick a component, about ten lines. Then
   press the browser's back button and watch nothing happen. Adding a
   `popstate` listener is the moment `react-router-dom` stops being
   ceremony.

5. **Let state outgrow one component.** Stay on `useState` until you are
   threading a setter three levels down and two numbers disagree. *That*
   is when Zustand earns its place — see the note in `label/store.ts`
   about a flag kept beside the value it derived from. Adding a
   dependency because you felt the problem is the only good reason.

6. **Style it last.** By then you know what elements exist, so you can
   write scoped CSS per view rather than one global sheet.

### The method, generalised

For each dependency in `package.json`, delete it and try to live without
it. You will either find you did not need it, or you will hit the exact
problem it solves. Both outcomes teach more than any explanation.

Measured honestly, this app needs **three** runtime dependencies —
`react`, `react-dom`, `leaflet`. `react-router-dom` is carrying four APIs
(`createBrowserRouter`, `RouterProvider`, `Navigate`, `useSearchParams`)
and `zustand` exactly one (`create`). Both are worth keeping, but neither
is load-bearing in the way the first three are.

## The file map

15 source files, 2,363 lines. Both views have the same four-part shape:
a pure module, a store, a view, and (for the planner) a map.

| Path | Lines | What it is |
|---|---|---|
| `src/main.tsx` | 22 | Entry. Two routes plus a catch-all redirect. |
| `src/app.css` | 243 | Every style in the app, as custom properties. |
| `src/api/types.ts` | 179 | The shapes the API returns, written from real responses. |
| `src/api/client.ts` | 142 | Every network call in one object. `detect()` is an async generator over NDJSON. |
| `src/chart/leaflet.ts` | 131 | Drawing primitives both maps share. |
| `src/chart/ChartMap.tsx` | 107 | The labeling map. |
| `src/label/logic.ts` | 121 | Filters, ordering, roles. No DOM. |
| `src/label/logic.test.ts` | 123 | 17 tests over the above. |
| `src/label/store.ts` | 180 | Labeling state. |
| `src/label/LabelView.tsx` | 294 | The labeling page. |
| `src/plan/format.ts` | 145 | Colours, number formatting, panel rows. No DOM. |
| `src/plan/format.test.ts` | 146 | 28 tests. |
| `src/plan/store.ts` | 170 | Planning state, in three stages of very different cost. |
| `src/plan/PlanView.tsx` | 246 | The planner page. |
| `src/plan/RouteMap.tsx` | 114 | The planner's map. |

Three patterns explain the shape:

- **Decisions are separated from drawing.** `logic.ts` and `format.ts`
  hold everything that can be wrong in a way a test should catch, which
  is why 45 tests run in under a second with no browser. The limit is
  worth knowing too: after the port both pages drew the whole United
  States, because the CSS assumed the layout rows were children of
  `<body>` and React mounts them inside `#root`. No pure function was
  wrong and no test could have failed. It was found by looking.
- **Leaflet stays imperative.** No React binding library. Nothing in
  `chart/` reads React state.
- **The front end computes nothing.** `scoreColor`, `deg` and `hhmm` are
  formatting, not calculation.

## What is deliberately absent

- **No CSS framework.** One stylesheet, plain custom properties.
- **No component library.** Every control is a plain element.
- **No ESLint.** `lint` is `tsc --noEmit`; strict TypeScript with
  `noUncheckedIndexedAccess` catches more here than a style linter would.
- **No data-fetching library.** Two stores and `fetch` are enough for
  three endpoints.

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

**`app.css` is one global stylesheet.** 25 id selectors and 16 bare
element selectors, shared by both views. This has already caused two
bugs: the planner's footer stacked vertically because `footer` is a
column for the labeler, and a `h2 .count b` rule existed twice. `#map`,
`#side` and `#flash` are each used by both views, which works only
because the router never renders both at once — an invariant nothing
enforces. Moving per-view rules into CSS Modules, which Vite supports
with no new dependency, would close both.
