import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, redirect, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { chartQuery, courseQuery, queryClient } from "./lib/queryClient";
import { routeOf, stopsOf } from "./lib/identSchema";
import AppToaster from "./components/AppToaster";
import LimitsDialog from "./components/LimitsDialog";
import ErrorAlert from "./components/ErrorAlert";
import { TooltipProvider } from "./components/ui/tooltip";
import { registerSW } from "virtual:pwa-register";
import { followDynamicType } from "./lib/dynamicType";
import { keepAddressThroughReload, startFresh } from "./lib/freshLoad";
import { installErrorReports, reportOf, sendReport } from "./lib/errorReports";
import MapPage from "./features/page/MapPage";
import { prefetchRouteMap } from "./features/plan/routeMapChunk";
import "./index.css";
import { followAppLinks, followBackButton, inNativeApp, nativePlatform } from "./lib/native";
import { startTv, tvPlatform } from "./lib/tv";

// The reader's text size from the iPhone's Settings, before the first
// render, so the page is never drawn at the wrong size first.
followDynamicType();

// On a Samsung or LG TV (tv/, lib/tv), the page made for its remote and
// its distance, before the first render.
const tv = tvPlatform();
if (tv) startTv(tv);

// The map's chunk (routeMapChunk),fetched while the page draws.
prefetchRouteMap();

// What goes wrong on the pilot's device, to the owner's log
// (lib/errorReports): before anything else can throw.
installErrorReports();

// The service worker (vite.config.ts): the app shell, the chart tiles
// the map has drawn or kept ahead, and the planner's answers, held for
// the air. It registers only on a secure origin (https, or localhost).
// A new build is taken at once (vite.config.ts, "autoUpdate"): the
// page reloads itself the moment the new worker has installed. The
// browser checks for a new worker on its own only on a navigation, so
// a page kept open -- the phone, all day -- asks every minute, and as
// it comes back to the front: an iPhone stops a page's timers while it
// is away, and the app brought back showed the build it was left on
// until a minute after. The check is one small request for sw.js. That
// reload keeps the route on screen; a person's starts clean
// (lib/freshLoad).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    window.setInterval(() => void registration.update(), 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update();
    });
  },
  onNeedReload() {
    keepAddressThroughReload();
    window.location.reload();
  },
});
startFresh();

// In the iOS and Android apps, a link to the site tapped elsewhere -- the
// sign-in link in Mail -- opens here, and Android's back closes what is
// open (lib/native).
if (inNativeApp()) void followAppLinks();
if (nativePlatform() === "android") void followBackButton();

// Three views, one app -- which is the point of the port. As separate
// HTML files they drifted: one grew a basemap fix the other never
// got, and each had its own copy of the course line, the halo and the
// markers. Now all of them import the same ones.
//
// The map page is in the first script: every page this app has is a
// map, so a chunk of its own was only a round trip later.
//
// basename "/app": the app is served under that prefix (webapp's
// WebMvcConfig), not at the domain root. Bare "/app"/"/app/" already
// redirect server-side to "/app/plan" (a real 500 otherwise -- see that
// config's own comment) -- the index route below handles it too, for
// any in-app `<Link to="/app">` that never leaves the client. Plan is
// the app's own homepage: the thing a pilot actually opens this for,
// not a page-index one page removed from it.

// One page in two modes, one for each role: the same shell around a
// different workspace -- the pilot's (the route, the nav log, the
// pilot's own console) and the developer's (the training workspace and
// the dev console). The two older addresses keep working: the labeling
// page is the Dev page now, and everything Settings held lives in
// Plan's pilot console.
const router = createBrowserRouter(
  [
    { index: true, element: <Navigate to="/plan" replace /> },
    // The planner with the first script, not asked for once it has run:
    // it is the page nearly every load is of, and its chunk was a second
    // round trip before anything showed (2 s to the panel on a phone's
    // CPU, cold). The training workspace inside it stays its own chunk.
    { path: "plan", element: <MapPage mode="pilot" /> },
    { path: "dev", element: <MapPage mode="dev" /> },
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
// The chart the map is drawn on, asked for now too: a map with no route
// waits on nothing else (and draws from the last answer kept, meanwhile).
void queryClient.prefetchQuery({ ...chartQuery, meta: { silent: true } });

const opening = new URLSearchParams(window.location.search);
const openingDep = opening.get("dep")?.trim().toUpperCase();
const openingDest = opening.get("dest")?.trim().toUpperCase();
const openingStops = stopsOf(opening.get("stops"));
if (routeOf(openingDep, openingDest, openingStops)) {
  // Quiet: if the planner is down, the page's own course query says so
  // once it mounts and asks again -- under the page's rule, not this one.
  void queryClient.prefetchQuery({ ...courseQuery(openingDep!, openingDest!, openingStops), meta: { silent: true } });
}

// A render React could not finish takes the page down: reported too.
ReactDOM.createRoot(document.getElementById("root")!, {
  onUncaughtError: error => { sendReport(reportOf("render", error)); console.error(error); },
}).render(
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
      <ErrorAlert />
      <LimitsDialog />
    </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
