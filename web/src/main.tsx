import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import RedirectKeepingSearch from "./components/RedirectKeepingSearch";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { registerSW } from "virtual:pwa-register";
import "./index.css";

// The service worker (vite.config.ts): the app shell, the chart tiles
// the map has drawn or kept ahead, and the planner's answers, held for
// the air. It registers only on a secure origin (https, or localhost)
// and takes a new build over on the next load without asking.
registerSW({ immediate: true });

const queryClient = new QueryClient();

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
// pilot's own console) and the developer's (the labeling workspace and
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
    { path: "label", element: <RedirectKeepingSearch to="/dev" /> },
    { path: "settings", element: <Navigate to="/plan" replace /> },
  ],
  { basename: "/app" },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Light, dark, or the OS's own choice -- the consoles' ThemeToggle
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
      {/* One instance for the whole app -- PageStatus's progress line
          (across every page that has one) renders through it via
          toast.loading/dismiss, rather than each page mounting its own
          floating status element.
          bottom-center everywhere -- nothing floats at the bottom of
          either page's own content (every corner button lives in a
          header now), and sonner's own default bottom margin clears
          Leaflet's attribution control without a page-specific number.
          closeButton: off by default in sonner, but the error toast
          below sets `duration: Infinity` (see usePageStatus) -- with
          no close button, the only way to dismiss it is for the error
          condition to clear itself in app state, and a pilot has no
          way to just get it off their screen while that's still true.
          richColors: every icon here (success/info/warning/error) is
          drawn with `fill="currentColor"` in sonner's own source, so
          without this they're all the same neutral text color --
          error and warning only actually READ as red/amber, distinct
          from a plain status toast, once this is on. Colors the
          toast's own background/border along with the icon (sonner's
          one built-in switch for both, not two separate settings).
          Nothing else set here -- position/closeButton/richColors are
          this app's only real requirements (a bottom-anchored spot,
          a way to dismiss an `Infinity`-duration error, colors that
          tell success/warning/error apart); everything else is
          sonner's own plain default, same as its own docs' own basic
          example. */}
      <Toaster
        position="bottom-center"
        closeButton
        richColors
        // A toast still on screen ("VFR flight not recommended") was
        // printing over the briefing's table; the paper is the
        // briefing alone.
        className="print:hidden"
      />
    </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
