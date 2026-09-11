import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
// The only place this ever gets loaded. Without it Leaflet's tiles,
// markers and controls have no positioning at all -- this is the
// library's own stylesheet, not app styling.
import "leaflet/dist/leaflet.css";
import LabelView from "./features/label/LabelView";
import PlanView from "./features/plan/PlanView";

// Two views, one app -- which is the point of the port. As separate HTML
// files they drifted: one grew a basemap fix the other never got, and
// each had its own copy of the course line, the halo and the markers.
// Now both import the same ones.
//
// No router: there are exactly two pages, each loaded by typing its own
// URL, and nothing in either view ever navigates to the other. A plain
// path check is the whole feature.
const View = window.location.pathname.endsWith("/label") ? LabelView : PlanView;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <View />
  </React.StrictMode>,
);
