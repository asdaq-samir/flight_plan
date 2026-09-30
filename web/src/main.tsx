import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, redirect, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { courseQuery, queryClient } from "./lib/queryClient";
import AppToaster from "./components/AppToaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { registerSW } from "virtual:pwa-register";
import "./index.css";

// The service worker (vite.config.ts): the app shell, the chart tiles
// the map has drawn or kept ahead, and the planner's answers, held for
// the air. It registers only on a secure origin (https, or localhost).
// A new build is taken at once (vite.config.ts, "autoUpdate"): the
// page reloads itself the moment the new worker has installed. The
// browser checks for a new worker on its own only on a navigation, so
// a page kept open -- the phone, all day -- asks every minute; the
// check is one small request for sw.js.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) window.setInterval(() => void registration.update(), 60_000);
  },
});

// Three views, one app -- which is the point of the port. As separate
// HTML files they drifted: one grew a basemap fix the other never
// got, and each had its own copy of the course line, the halo and the
// markers. Now all of them import the same ones.
//
// Every route is its own lazy chunk (React Router's own `lazy()`, not
// `React.lazy()` -- one less concept, and it's what replaces the old
// catch-all fallback with an explicit route table): Settings has no
// map and no reason to pay for Leaflet (or for Plan/Label's own code)
// just because they share a build.
// `leaflet/dist/leaflet.css` -- without it Leaflet's tiles, markers and
// controls have no positioning at all -- lives inside Plan/Label's own
// view files for the same reason, rather than loading unconditionally
// here for pages that never touch a map.
//
// basename "/app": the app is served under that prefix (webapp's
// WebMvcConfig), not at the domain root. Bare "/app"/"/app/" already
// redirect server-side to "/app/plan" (a real 500 otherwise -- see that
// config's own comment) -- the index route below handles it too, for
// any in-app `<Link to="/app">` that never leaves the client. Plan is
// the app's own homepage: the thing a pilot actually opens this for,
// not a page-index one page removed from it.
// Each lazy route's own chunk hasn't downloaded yet the first time its
// path loads, and the router wants something to render for that gap --
// `null`, matching this app's own long-standing call (see the removed
// `<Suspense fallback={null}>` this replaced): a loading flash for
// something usually faster than the page's own map tiles isn't worth a
// skeleton.
const noFallback = { HydrateFallback: () => null };

// One page in two modes, one for each role: the same shell around a
// different workspace -- the pilot's (the route, the nav log, the
// pilot's own console) and the developer's (the training workspace and
// the dev console). The two older addresses keep working: the labeling
// page is the Dev page now, and everything Settings held lives in
// Plan's pilot console.
const router = createBrowserRouter(
  [
    { index: true, element: <Navigate to="/plan" replace /> },
    {
      path: "plan",
      lazy: () => import("./features/page/MapPage").then(m => ({ element: <m.default mode="pilot" /> })),
      ...noFallback,
    },
    {
      path: "dev",
      lazy: () => import("./features/page/MapPage").then(m => ({ element: <m.default mode="dev" /> })),
      ...noFallback,
    },
    // The old labeling address, kept working with its route: a loader
    // redirect rather than a component, since the router's own
    // `redirect` is the one place a query string can be carried over
    // before anything renders.
    {
      path: "label",
      loader: ({ request }) => redirect(`/dev${new URL(request.url).search}`),
    },
    { path: "settings", element: <Navigate to="/plan" replace /> },
  ],
  { basename: "/app" },
);

/**
 * The route the address already names, asked for before React mounts.
 *
 * Measured on a phone-shaped CPU budget, cold: this chunk finishes at
 * about 70ms and the planner was not asked for the course until 1,800ms
 * -- the whole of React mounting, the router resolving and the
 * workspace rendering happened first, with the request waiting behind
 * all of it for a route the URL had named from the start. The map
 * cannot draw until the course answers, so that wait is the grey.
 *
 * `prefetchQuery` with the key and the fetcher `usePlan` uses, so the
 * component finds the answer already in the cache rather than asking
 * again. Only when the address names both ends: without them the page
 * asks the server which route to open, which is a different question.
 */
const opening = new URLSearchParams(window.location.search);
const openingDep = opening.get("dep")?.trim().toUpperCase();
const openingDest = opening.get("dest")?.trim().toUpperCase();
if (openingDep && openingDest && openingDep !== openingDest) {
  // Quiet: if the planner is down, the page's own course query says so
  // once it mounts and asks again -- under the page's rule, not this one.
  void queryClient.prefetchQuery({ ...courseQuery(openingDep, openingDest), meta: { silent: true } });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Light, dark, or the OS's own choice -- the settings' Theme
        sets it, next-themes keeps it and puts the `dark` class on
        <html>, which is what every colour token in index.css keys off
        (and what the Toaster below already reads). */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="vfr.theme" disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      {/* One instance for the whole app, the same as sonner's own
          Toaster below -- every icon-only button's own Tooltip shares
          this one delay/grouping context (hover one, then another
          shows instantly) instead of each re-running its own
          default-delay timer independently. */}
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
      <AppToaster />
    </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
