// A load test of the planner through the webapp, with k6
// (https://k6.io): pilots planning a few routes at once -- the course,
// the checkpoints, the nav log and the briefing, as the page asks for
// them -- and the times each takes under it.
//
//   docker run --rm -i --add-host=host.docker.internal:host-gateway \
//     -e BASE_URL=http://host.docker.internal:8080 grafana/k6 run - < load/plan.js
//
// VUS and DURATION set how many pilots and for how long (5 and 1m by
// default). The planner caches a route's work for 15 minutes, so the
// first pass of each route is the cold one and the rest are warm: the
// thresholds are the warm path's, the cold one shows in the maximum.
// Not part of CI -- it asks aviationweather.gov and the FAA through the
// planner, and the numbers are this machine's.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const ROUTES = [
  "dep=C81&dest=KDLH",
  "dep=KDPA&dest=KMSN",
  "dep=KUGN&dest=KRFD",
  "dep=C81&dest=KDLH&stops=KMSN",
];

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "1m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "course_ms": ["p(95)<500"],
    "checkpoints_ms": ["p(95)<2000"],
    "navlog_ms": ["p(95)<5000"],
    "briefing_ms": ["p(95)<3000"],
  },
};

const timings = {
  course: new Trend("course_ms", true),
  checkpoints: new Trend("checkpoints_ms", true),
  navlog: new Trend("navlog_ms", true),
  briefing: new Trend("briefing_ms", true),
};

export default function () {
  const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
  for (const [name, path] of [["course", "course"], ["checkpoints", "checkpoints"], ["navlog", "navlog"], ["briefing", "briefing"]]) {
    const res = http.get(`${BASE}/api/planner/${path}?${route}`, { tags: { name }, timeout: "180s" });
    check(res, { [`${name} answered`]: r => r.status === 200 });
    timings[name].add(res.timings.duration);
  }
  sleep(1);
}
