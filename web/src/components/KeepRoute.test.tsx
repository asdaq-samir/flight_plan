// @vitest-environment jsdom
/**
 * The keep-route download: held by keepRoute's store, not by the button,
 * so closing the console no longer cancels it; one keep at a time, the
 * latest the one that writes; and a download that got nothing is not
 * reported as kept. The network and the service worker are stubbed.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ChartLayer, Course } from "../lib/api/types";
import { WORKER_WAIT_MS, keep, keepKey, useKeepJob } from "../lib/map/keepRoute";
import KeepRoute from "./KeepRoute";

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

describe("the keep button", () => {
  test("closing it mid-download does not cancel the download, and it shows where it got to when opened again", async () => {
    const slow = network(ok, true);
    const { unmount } = render(<KeepRoute course={COURSE} />);
    fireEvent.click(screen.getByTestId("keep-route"));
    await flush();
    unmount();

    // Each answer lets its worker ask for the next tile: answer until done.
    for (let i = 0; i < 50 && useKeepJob.getState().status === "keeping"; i++) {
      slow.release();
      await flush();
    }

    render(<KeepRoute course={COURSE} />);
    expect(screen.getByTestId("keep-route-status").textContent).toMatch(/kept\. The route draws without a connection now\./);
  });

  test("a keep where every tile failed is not reported as kept", async () => {
    network(() => new Response("", { status: 503 }));
    render(<KeepRoute course={COURSE} />);
    fireEvent.click(screen.getByTestId("keep-route"));
    await flush();
    await flush();

    expect(screen.getByTestId("keep-route-status").textContent).toMatch(/None of the tiles could be fetched/);
  });

  test("another chart's keep is not this one's to report", async () => {
    network(ok);
    await keep(COURSE, IFR_LOW);
    render(<KeepRoute course={COURSE} />);   // the base preference is the sectional

    expect(screen.getByTestId("keep-route-status").textContent).toMatch(/^Every Sectional tile/);
  });
});
