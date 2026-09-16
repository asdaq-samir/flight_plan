import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Five views, one app -- which is the point of the port. As separate
// HTML files they drifted: one grew a basemap fix the other never
// got, and each had its own copy of the course line, the halo and the
// markers. Now all of them import the same ones.
//
// Every view is a separate lazy chunk, not a static import: Home,
// Playground and Account have no map and no reason to pay for
// Leaflet (or for Plan/Label's own code) just because they share a
// build. `leaflet/dist/leaflet.css` -- without it Leaflet's tiles,
// markers and controls have no positioning at all -- moves inside
// Plan/Label's own view files for the same reason, rather than
// loading unconditionally here for pages that never touch a map.
//
// No router: each page is loaded by typing its own URL, and (each
// page's own header links aside) nothing navigates to another via
// client-side state. A plain path check is the whole feature --
// checked before the catch-all so a later page doesn't fall through
// to it. Bare `/app` (or `/app/`) redirects server-side (WebMvcConfig)
// to `/app/home`, since a bare root is a real 500 there, not just an
// unhandled case here.
const HomeView = lazy(() => import("./features/home/HomeView"));
const LabelView = lazy(() => import("./features/label/LabelView"));
const PlanView = lazy(() => import("./features/plan/PlanView"));
const PlaygroundView = lazy(() => import("./features/playground/PlaygroundView"));
const AccountView = lazy(() => import("./features/account/AccountView"));

const path = window.location.pathname.replace(/\/+$/, "");
const View = path.endsWith("/label")
  ? LabelView
  : path.endsWith("/playground")
  ? PlaygroundView
  : path.endsWith("/account")
  ? AccountView
  : path.endsWith("/plan")
  ? PlanView
  : path.endsWith("/home")
  ? HomeView
  : PlanView;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* No fallback UI -- the lazy chunk for whichever single page
        this document load is for starts fetching immediately
        alongside the rest of the bundle's own network requests, and
        a loading flash for something usually faster than the page's
        own map tiles isn't worth a skeleton. */}
    <Suspense fallback={null}>
      <View />
    </Suspense>
  </React.StrictMode>,
);
