// @vitest-environment jsdom
/**
 * The keep-route download: held by keepRoute's store, not by the
 * setting, so closing the settings does not cancel it; one keep at a time, the
 * latest the one that writes; and a download that got nothing is not
 * reported as kept. The network and the service worker are stubbed.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../api/client";
import type { AirportPlace, ChartLayer, Course } from "../api/types";
import { WORKER_WAIT_MS, keep, keepKey, keptAlready, stopKeeping, useKeepJob, useKeptCharts } from "./keepRoute";
import { toast } from "sonner";
import { useKeepRouteToast } from "./keepStatus";

vi.mock("sonner", () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

const layer = (kind: string): ChartLayer =>
  ({ kind, label: kind === "sec" ? "Sectional" : "IFR low", min_zoom: 3, max_zoom: 9, base: true, over: [], sheets: [] }) as ChartLayer;
const SEC = layer("sec");
const IFR_LOW = layer("ifr_low");
const COURSE = {
  departure: { ident: "C81" }, destination: { ident: "KDLH" },
  course_line: [[42.3, -88.1], [42.4, -88.2]],
  chart_cycle: "09-03-2026", chart_revision: 1, chart_tiles_base: null, chart_layers: [SEC, IFR_LOW],
} as unknown as Course;

/** fetch, answering each call when `release` is called (or at once). */
function network(answer: () => Response, held = false) {
  const waiting: (() => void)[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const go = () => (init?.signal?.aborted ? reject(new DOMException("aborted", "AbortError")) : resolve(answer()));
    if (held) waiting.push(go); else go();
  }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, release: () => waiting.splice(0).forEach(go => go()) };
}

const ok = () => new Response("", { status: 200 });
const flush = () => act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); });

beforeEach(() => {
  useKeepJob.setState({ status: "idle" }, true);
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve({}) }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("keeping a route's charts", () => {
  test("goes from keeping to kept, under the route, chart, edition and revision", async () => {
    network(ok);
    const done = keep(COURSE, SEC);
    expect(useKeepJob.getState()).toMatchObject({ status: "keeping", key: "C81->KDLH/sec/09-03-2026/1" });
    await done;

    const job = useKeepJob.getState();
    expect(job.status).toBe("kept");
    expect(job.status === "kept" && job.progress.failed).toBe(0);
  });

  test("keeps the route's airports' diagrams with its tiles", async () => {
    const { fetch } = network(ok);
    // The cards, through the planner's client (which holds its own fetch).
    vi.spyOn(api, "airport").mockImplementation(ident =>
      Promise.resolve({ ident, airport_diagram_cycle: ident === "KDLH" ? "2610" : null } as AirportPlace));
    await keep(COURSE, SEC);
    const asked = fetch.mock.calls.map(([url]) => url);
    expect(asked.filter(url => url.includes("/airport-diagram/"))).toEqual(["/api/planner/airport-diagram/2610/KDLH.png"]);
  });

  test("a second keep cancels the first, and the first finishing late writes nothing", async () => {
    const slow = network(ok, true);
    const first = keep(COURSE, SEC);
    await flush();
    network(ok);
    await keep(COURSE, IFR_LOW);
    expect(useKeepJob.getState()).toMatchObject({ status: "kept", key: keepKey(COURSE, "ifr_low") });

    slow.release();
    await first;
    expect(useKeepJob.getState()).toMatchObject({ status: "kept", key: keepKey(COURSE, "ifr_low") });
  });

  test("with no service worker to hold them, it says so rather than keeping for ever", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "serviceWorker", { value: { ready: new Promise(() => {}) }, configurable: true });
    const done = keep(COURSE, SEC);
    await vi.advanceTimersByTimeAsync(WORKER_WAIT_MS + 1);
    await done;

    expect(useKeepJob.getState()).toMatchObject({ status: "failed" });
  });
});

describe("what a keep remembers, and stopping one", () => {
  test("a keep that got its tiles is remembered, so the route opened again is not fetched again", async () => {
    network(ok);
    await keep(COURSE, SEC);
    expect(keptAlready(keepKey(COURSE, "sec"))).toBe(true);
  });

  test("a keep where every tile failed is not remembered as kept", async () => {
    useKeptCharts.setState({ kept: {} });
    network(() => new Response("", { status: 503 }));
    await keep(COURSE, SEC);
    expect(useKeepJob.getState()).toMatchObject({ status: "kept" });
    expect(keptAlready(keepKey(COURSE, "sec"))).toBe(false);
  });

  test("turned off, a keep under way stops and the job is idle", async () => {
    const slow = network(ok, true);
    const done = keep(COURSE, SEC);
    await flush();
    stopKeeping();
    // The fetches under way answer as aborted.
    slow.release();
    await done;
    expect(useKeepJob.getState()).toEqual({ status: "idle" });
  });
});

describe("the keep's toast", () => {
  test("counts while it keeps, then says kept -- and an old keep is not news", async () => {
    vi.mocked(toast.loading).mockClear();
    vi.mocked(toast.success).mockClear();
    network(ok);
    await keep(COURSE, SEC);
    const quiet = renderHook(() => useKeepRouteToast());
    expect(toast.success).not.toHaveBeenCalled();
    quiet.unmount();

    renderHook(() => useKeepRouteToast());
    const done = keep(COURSE, SEC);
    await flush();
    expect(toast.loading).toHaveBeenCalled();
    await act(async () => { await done; });
    expect(toast.success).toHaveBeenCalledWith("Charts kept offline", expect.objectContaining({ id: "keep-route" }));
  });
});
