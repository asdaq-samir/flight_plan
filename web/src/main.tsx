import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./components/ui/sonner";
import "./index.css";

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

const router = createBrowserRouter(
  [
    { index: true, element: <Navigate to="/plan" replace /> },
    {
      path: "plan",
      lazy: () => import("./features/plan/PlanView").then(m => ({ Component: m.default })),
      ...noFallback,
    },
    {
      path: "label",
      lazy: () => import("./features/label/LabelView").then(m => ({ Component: m.default })),
      ...noFallback,
    },
    {
      path: "settings",
      lazy: () => import("./features/settings/SettingsView").then(m => ({ Component: m.default })),
      ...noFallback,
    },
  ],
  { basename: "/app" },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* One instance for the whole app -- PageStatus's progress line
          (across every page that has one) renders through it via
          toast.loading/dismiss, rather than each page mounting its own
          floating status element.
          Every page that shows one also has its own corner buttons
          (MapGuideButton bottom-left, the sidebar trigger bottom-right)
          -- and sonner deliberately makes toasts full-width below a
          600px viewport (its own mobile breakpoint, not something a
          `--width` override can beat), so a bottom toast would
          unavoidably overlap one of those. offset clears Plan/Label's
          own merged header row (route form + Settings gear, ~56px),
          landing the toast over the map/content below instead -- the
          one thing on screen safe to briefly sit on top of.
          mobileOffset, not just offset: sonner reads a completely
          separate `--mobile-offset-*` custom property below its own
          600px breakpoint (this app's actual viewport), so `offset`
          alone is silently ignored there.
          closeButton: off by default in sonner, but the error toast
          below sets `duration: Infinity` (see usePageStatus) -- with
          no close button, the only way to dismiss it is for the error
          condition to clear itself in app state, and a pilot has no
          way to just get it off their screen while that's still true. */}
      <Toaster
        position="top-center"
        offset={{ top: "90px" }}
        mobileOffset={{ top: "90px" }}
        closeButton
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
