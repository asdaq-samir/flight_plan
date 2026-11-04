// @vitest-environment jsdom
/**
 * The overlays' questions sent from the map's own events (useAhead): each
 * layer's request leaves as the map moves, before React has rendered the
 * new box, with the very key the layer's own useQuery then asks with -- at
 * the zooms either side of each layer's gates -- so the layer finds its
 * answer on the way and asks nothing again. And a flight (flyTo) asks for
 * where it lands as it takes off, the airports' marks there drawn then and
 * those drawn already kept until it lands. The planner is stubbed.
 */
import type L from "leaflet";
import type { ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { MapContainer } from "react-leaflet";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AirportPin } from "../api/types";

// view.ts asks the window whether it hovers as it loads, and the motion
// rules whether to fade; jsdom has no matchMedia, so one is there before
// the imports run.
vi.hoisted(() => {
  window.matchMedia = ((media: string) => ({
    matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })) as unknown as typeof window.matchMedia;
});
const { default: Leaflet } = await import("leaflet");
const { api } = await import("../api/client");
const { queryClient } = await import("../queryClient");
const { usePreferences } = await import("../preferences");
const { AirportMarksLayer } = await import("./AirportCanvas");
const { AirportsLayer, airportsQuery } = await import("./AirportsLayer");
const { AirspaceLayer, airspaceQuery } = await import("./AirspaceLayer");
const { NavaidsLayer, navaidsQuery } = await import("./NavaidsLayer");
const { WaypointsLayer, waypointsQuery } = await import("./WaypointsLayer");
const { aheadOf } = await import("./view");

const CHICAGO: [number, number] = [41.88, -87.63];
const field = (ident: string, lat: number, lon: number, kind: AirportPin["kind"]) =>
  ({ ident, name: ident, lat, lon, kind, airspace_class: null, flight_category: "VFR", military: null, private: false, primary_of: null }) as unknown as AirportPin;
/** O'Hare, large, in sight at 7 round Chicago; Oshkosh, medium, from 8. */
const FIELDS = [field("KORD", 41.98, -87.9, "large"), field("KOSH", 43.98, -88.56, "medium")];

let spies: Record<"airports" | "airspace" | "navaids" | "waypoints", MockInstance>;
// A phone's view, 390 by 844 points: jsdom lays nothing out.
const sized = (["clientWidth", "clientHeight"] as const).map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
const getContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 844 });
  // The canvases draw nothing here, and say nothing of it.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof getContext;
  spies = {
    airports: vi.spyOn(api, "airportsInView").mockImplementation(box =>
      Promise.resolve(FIELDS.filter(a => a.lat >= box.south && a.lat <= box.north && a.lon >= box.west && a.lon <= box.east))),
    airspace: vi.spyOn(api, "airspaceInView").mockImplementation(() => Promise.resolve([])),
    navaids: vi.spyOn(api, "navaidsInView").mockImplementation(() => Promise.resolve({ vors: [], fixes: [] } as unknown as Awaited<ReturnType<typeof api.navaidsInView>>)),
    waypoints: vi.spyOn(api, "waypointsInView").mockImplementation(() => Promise.resolve([])),
  };
});
afterAll(() => {
  for (const [name, was] of sized) if (was) Object.defineProperty(HTMLElement.prototype, name, was);
  HTMLCanvasElement.prototype.getContext = getContext;
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  for (const spy of Object.values(spies)) spy.mockClear();
  usePreferences.setState({ airspace: true, navaids: true });
});

/** The answers come and React renders them: the query cache tells its
 *  observers a task after an answer, so a few tasks are let by. */
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
});

async function mount(layer: ReactNode, zoom: number): Promise<L.Map> {
  const made: { map?: L.Map } = {};
  render(
    <QueryClientProvider client={queryClient}>
      <MapContainer center={CHICAGO} zoom={zoom} zoomAnimation={false} fadeAnimation={false} ref={(m: L.Map | null) => { if (m) made.map = m; }}>
        {layer}
      </MapContainer>
    </QueryClientProvider>,
  );
  await settle();
  return made.map!;
}

/** The keys a family's layer asks with now: its queries with an enabled
 *  observer (the layer's useQuery). */
const layerKeys = (family: string): QueryKey[] =>
  queryClient.getQueryCache().findAll({ queryKey: [family] }).filter(q => q.isActive()).map(q => q.queryKey);
const fetching = (family: string): QueryKey[] =>
  queryClient.getQueryCache().findAll({ queryKey: [family], fetchStatus: "fetching" }).map(q => q.queryKey);

/**
 * A move of the map (`move`, run inside act), and what it asked: the
 * requests that left at the event, before React rendered, and the key the
 * layer asks with once it has. The render asks the planner nothing more.
 */
function moved(family: string, spy: MockInstance, move: () => void) {
  const before = spy.mock.calls.length;
  let atEvent = { calls: before, keys: [] as QueryKey[] };
  act(() => {
    move();
    atEvent = { calls: spy.mock.calls.length, keys: fetching(family) };
  });
  const keys = layerKeys(family);
  expect(spy.mock.calls.length, "the layer's render asked again").toBe(atEvent.calls);
  // What the layer asks with is what the event asked for, or what was
  // answered before it.
  for (const key of keys) {
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true })!;
    expect(query.state.data !== undefined || atEvent.keys.some(k => JSON.stringify(k) === JSON.stringify(key))).toBe(true);
  }
  return { asked: atEvent.calls - before, keys };
}

/** A wheel's or a double tap's zoom as Leaflet starts it (zoomanim), then
 *  as it ends: the end asks nothing the start did not. */
function zoomTo(map: L.Map, zoom: number, family: string, spy: MockInstance) {
  const start = moved(family, spy, () => map.fire("zoomanim", { center: map.getCenter(), zoom, noUpdate: false }));
  const end = moved(family, spy, () => map.setView(map.getCenter(), zoom, { animate: false }));
  expect(end.asked, "the zoom's end asked again").toBe(0);
  expect(end.keys).toEqual(start.keys);
  return start;
}

describe("each layer's query", () => {
  const box = aheadOf(Leaflet.latLngBounds([41.5, -88.5], [42.5, -87]));
  it("keeps the keys the layers asked with", () => {
    expect(airspaceQuery(box, 6, true).queryKey).toEqual(["airspaceInView", box.key, "B"]);
    expect(airspaceQuery(box, 7, true).queryKey).toEqual(["airspaceInView", box.key, "BC"]);
    expect(airspaceQuery(box, 8, true).queryKey).toEqual(["airspaceInView", box.key, "BCD"]);
    expect(navaidsQuery(box, 9, true).queryKey).toEqual(["navaidsInView", box.key, false]);
    expect(navaidsQuery(box, 10, true).queryKey).toEqual(["navaidsInView", box.key, true]);
    expect(waypointsQuery(box, 10).queryKey).toEqual(["waypointsInView", box.key]);
    expect(airportsQuery(box, 7).queryKey).toEqual(["airportsInView", box.key, true]);
    expect(airportsQuery(box, 8).queryKey).toEqual(["airportsInView", box.key, false]);
  });
  it("is off under each layer's zoom and where the settings turn it off", () => {
    expect([5, 6].map(z => airspaceQuery(box, z, true).enabled)).toEqual([false, true]);
    expect(airspaceQuery(box, 9, false).enabled).toBe(false);
    expect([7, 8].map(z => navaidsQuery(box, z, true).enabled)).toEqual([false, true]);
    expect(navaidsQuery(box, 9, false).enabled).toBe(false);
    expect([9, 10].map(z => waypointsQuery(box, z).enabled)).toEqual([false, true]);
    expect([3, 4].map(z => airportsQuery(box, z).enabled)).toEqual([false, true]);
  });
});

describe("a layer's question, sent from the map's event", () => {
  it("asks for the airspace at each zoom's start with the layer's own key", async () => {
    const map = await mount(<AirspaceLayer />, 5);
    expect(spies.airspace).not.toHaveBeenCalled();
    const classes = [6, 7, 8, 9].map(z => zoomTo(map, z, "airspaceInView", spies.airspace));
    // B from 6, C from 7, D from 8: each new class asked as the zoom starts.
    expect(classes.slice(0, 3).map(c => c.asked)).toEqual([1, 1, 1]);
    expect(classes.map(c => c.keys.map(k => k[2]))).toEqual([["B"], ["BC"], ["BCD"], ["BCD"]]);
  });

  it("asks nothing for airspace turned off", async () => {
    usePreferences.setState({ airspace: false });
    const map = await mount(<AirspaceLayer />, 8);
    expect(zoomTo(map, 9, "airspaceInView", spies.airspace).asked).toBe(0);
    expect(spies.airspace).not.toHaveBeenCalled();
  });

  it("asks for the VORs from 8 and the fixes from 10", async () => {
    const map = await mount(<NavaidsLayer />, 7);
    expect(spies.navaids).not.toHaveBeenCalled();
    const steps = [8, 9, 10, 11].map(z => zoomTo(map, z, "navaidsInView", spies.navaids));
    expect(steps[0]!.asked).toBe(1);
    expect(steps[2]!.asked).toBe(1);
    expect(steps.map(s => s.keys.map(k => k[2]))).toEqual([[false], [false], [true], [true]]);
  });

  it("asks for the VFR waypoints from 10", async () => {
    const map = await mount(<WaypointsLayer exclude={new Set()} />, 9);
    expect(zoomTo(map, 9, "waypointsInView", spies.waypoints).asked).toBe(0);
    expect(spies.waypoints).not.toHaveBeenCalled();
    expect(zoomTo(map, 10, "waypointsInView", spies.waypoints).asked).toBe(1);
    expect(layerKeys("waypointsInView")).toHaveLength(1);
  });

  it("asks for the airports that report out to 7 and every field from 8", async () => {
    const map = await mount(<AirportsLayer selected={null} onSelect={() => {}} others={[]} route={null} />, 3);
    expect(spies.airports).not.toHaveBeenCalled();
    const steps = [4, 7, 8, 9].map(z => zoomTo(map, z, "airportsInView", spies.airports));
    expect(steps[0]!.asked).toBe(1);
    expect(steps[2]!.asked).toBe(1);
    expect(steps.map(s => s.keys.map(k => k[2]))).toEqual([[true], [true], [false], [false]]);
  });

  it("asks a question the planner failed once more at most, not at every move", async () => {
    spies.navaids.mockImplementation(() => Promise.reject(new Error("The planner is down")));
    try {
      const map = await mount(<NavaidsLayer />, 9);
      const atMount = spies.navaids.mock.calls.length;
      expect(atMount).toBe(1);
      for (let i = 0; i < 4; i++) {
        act(() => { map.panBy([4, 0], { animate: false }); });
        await settle();
      }
      expect(spies.navaids.mock.calls.length).toBeLessThanOrEqual(atMount + 1);
    } finally {
      spies.navaids.mockImplementation(() => Promise.resolve({ vors: [], fixes: [] } as unknown as Awaited<ReturnType<typeof api.navaidsInView>>));
    }
  });

  it("asks for a pan's new ground as the map moves", async () => {
    const map = await mount(<NavaidsLayer />, 9);
    const pan = moved("navaidsInView", spies.navaids, () => map.panBy([1600, 0], { animate: false }));
    expect(pan.asked).toBe(1);
    expect(pan.keys).toHaveLength(1);
  });
});

describe("a flight", () => {
  it("fires where it will land as it takes off, and not when it is set at once", () => {
    const container = document.createElement("div");
    const map = Leaflet.map(container, { zoomAnimation: false, fadeAnimation: false }).setView(CHICAGO, 7);
    const heard: { center: L.LatLng; zoom: number }[] = [];
    map.on("flystart", e => heard.push(e as unknown as { center: L.LatLng; zoom: number }));
    const browser = Leaflet.Browser as { any3d: boolean };
    const any3d = browser.any3d;
    browser.any3d = true;
    let at = 0;
    try {
      map.flyTo([43.98, -88.56], 10, { duration: 0.01 });
      map.stop();
      // No zoom given: it lands at the zoom it is at.
      at = map.getZoom();
      map.flyTo([42.5, -88], undefined, { duration: 0.01 });
      map.stop();
      map.flyTo([42.5, -88], 9, { animate: false });
    } finally {
      browser.any3d = any3d;
      map.remove();
    }
    expect(heard.map(e => [e.center.lat, e.center.lng, e.zoom])).toEqual([[43.98, -88.56, 10], [42.5, -88, at]]);
  });

  it("asks for where it lands and draws the airports there as it takes off", { timeout: 15_000 }, async () => {
    const setMarks = vi.spyOn(AirportMarksLayer.prototype, "setMarks");
    const drawn = () => (setMarks.mock.lastCall?.[0] ?? []).map(m => m.ident).sort();
    const map = await mount(<><AirportsLayer selected={null} onSelect={() => {}} others={[]} route={null} /><NavaidsLayer /></>, 7);
    await waitFor(() => expect(drawn()).toEqual(["KORD"]));
    const navaidsAtRest = layerKeys("navaidsInView");
    const browser = Leaflet.Browser as { any3d: boolean };
    const any3d = browser.any3d;
    const asked = { airports: spies.airports.mock.calls.length, navaids: spies.navaids.mock.calls.length };
    act(() => {
      browser.any3d = true;
      try {
        map.flyTo([43.98, -88.56], 10, { duration: 2 });
      } finally {
        browser.any3d = any3d;
      }
      // Asked as it takes off, before React has rendered: every field at
      // Oshkosh, and the VORs and fixes there.
      const airports = spies.airports.mock.calls.slice(asked.airports).map(c => c[0]);
      expect(airports).toHaveLength(1);
      expect(airports[0]).toMatchObject({ reporting: false });
      expect(airports[0]!.south).toBeLessThan(43.98);
      expect(airports[0]!.north).toBeGreaterThan(43.98);
      expect(spies.navaids.mock.calls.slice(asked.navaids).map(c => c[1])).toEqual([true]);
    });
    // In the air: Oshkosh drawn for where it lands, O'Hare as it was, and
    // the VORs still drawn for where it took off.
    await waitFor(() => expect(drawn()).toEqual(["KORD", "KOSH"]));
    expect(map.getZoom()).toBeLessThan(10);
    expect(layerKeys("navaidsInView")).toEqual(navaidsAtRest);
    // Landed: Oshkosh alone, and nothing asked again for it.
    await waitFor(() => expect(map.getZoom()).toBe(10), { timeout: 5000 });
    await waitFor(() => expect(drawn()).toEqual(["KOSH"]));
    expect(spies.airports.mock.calls.length).toBe(asked.airports + 1);
    expect(spies.navaids.mock.calls.length).toBe(asked.navaids + 1);
    expect(layerKeys("navaidsInView").map(k => k[2])).toEqual([true]);
  });
});
