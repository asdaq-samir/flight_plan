import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import LabelView from "./label/LabelView";
import PlanView from "./plan/PlanView";
import "./app.css";

// Two views, one app -- which is the point of the port. As separate HTML
// files they drifted: one grew a basemap fix the other never got, and
// each had its own copy of the course line, the halo and the markers.
// Now both import the same ones.
const router = createBrowserRouter([
  { path: "/app/plan", element: <PlanView /> },
  { path: "/app/label", element: <LabelView /> },
  { path: "*", element: <Navigate to="/app/plan" replace /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
