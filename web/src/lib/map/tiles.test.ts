import { describe, expect, it } from "vitest";
import type { ChartLayer, Course } from "../api/types";
import { PREFETCH_SLICE_MS, TilePrefetch, chartPair, levelAhead, sheetAt, tileDensity, tileTemplate, tileUrl, tilesAround, type IdleRun } from "./tiles";

const course = { chart_cycle: "09-03-2026", chart_revision: 2, chart_tiles_base: null } as unknown as Course;

describe("tile URLs", () => {
  it("carry the cycle and the revision, so a re-render within a cycle is fetched afresh", () => {
    expect(tileUrl(course, "sec", 9, 124, 184)).toBe("/api/planner/chart-tile/sec/9/124/184.png?c=09-03-2026&r=2");
  });

  it("carry the revision from the CDN too, where the cycle is a path segment", () => {
    const published = { ...course, chart_tiles_base: "https://tiles.example" } as Course;
    expect(tileTemplate(published, "tac")).toBe("https://tiles.example/09-03-2026/tac/{z}/{x}/{y}.png?r=2");
  });

  it("carry each kind's own cycle, as each goes over to a new one when its own pass is finished", () => {
    const turning = {
      ...course, chart_cycle: "10-29-2026", chart_revision: 0,
      chart_layers: [{ kind: "sec", cycle: "10-29-2026", revision: 0 }, { kind: "ifr_low", cycle: "09-03-2026", revision: 3 }],
    } as unknown as Course;
    expect(tileUrl(turning, "sec", 1, 2, 3)).toBe("/api/planner/chart-tile/sec/1/2/3.png?c=10-29-2026&r=0");
    expect(tileUrl(turning, "ifr_low", 1, 2, 3)).toBe("/api/planner/chart-tile/ifr_low/1/2/3.png?c=09-03-2026&r=3");
    // A layer that names none: the chart's own.
    expect(tileUrl(turning, "tac", 1, 2, 3)).toBe("/api/planner/chart-tile/tac/1/2/3.png?c=10-29-2026&r=0");
  });

  it("reads a course from before the revision existed as revision 0", () => {
    const older = { chart_cycle: "09-03-2026", chart_tiles_base: null } as unknown as Course;
    expect(tileUrl(older, "sec", 1, 2, 3)).toBe("/api/planner/chart-tile/sec/1/2/3.png?c=09-03-2026&r=0");
  });
});

describe("the tiles' density", () => {
  const sharp = {
    ...course, chart_layers: [{ kind: "sec", cycle: "09-03-2026", revision: 2, scales: [1, 2] }, { kind: "tac", scales: [1] }],
  } as unknown as Course;

  it("is the 512-pixel tile on a 2x or 3x screen, where the kind was drawn at it", () => {
    expect(tileDensity(sharp, "sec", 3)).toBe("@2x");
    expect(tileDensity(sharp, "sec", 2)).toBe("@2x");
  });

  it("is the 256-pixel tile on a 1x screen, for a kind drawn without, and for a course from before scales", () => {
    expect(tileDensity(sharp, "sec", 1)).toBe("");
    expect(tileDensity(sharp, "tac", 3)).toBe("");
    expect(tileDensity(course, "sec", 3)).toBe("");
  });

  it("names the 512-pixel tile beside the plain one, from the planner and from the CDN", () => {
    const ratio = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 3;
    try {
      expect(tileUrl(sharp, "sec", 9, 124, 184)).toBe("/api/planner/chart-tile/sec/9/124/184@2x.png?c=09-03-2026&r=2");
      const published = { ...sharp, chart_tiles_base: "https://tiles.example" } as Course;
      expect(tileTemplate(published, "sec")).toBe("https://tiles.example/09-03-2026/sec/{z}/{x}/{y}@2x.png?r=2");
    } finally {
      globalThis.devicePixelRatio = ratio;
    }
  });
});

const layer = (kind: string, base: boolean, over: string[] = [], sheets: ChartLayer["sheets"] = []): ChartLayer =>
  ({ kind, label: kind, min_zoom: base ? 3 : 10, max_zoom: 12, base, over, sheets }) as ChartLayer;
const CHICAGO = { name: "Chicago", label: "Chicago TAC", west: -89.5, south: 41.0, east: -86.8, north: 42.8 };
const IFR_CHICAGO = { name: "ENR_AREA_CHI", label: "IFR area chart", west: -89.8, south: 40.9, east: -86.5, north: 43.0 };
const LAYERS = [
  layer("sec", true), layer("ifr_low", true), layer("tac", false, ["sec"], [CHICAGO]),
  layer("ifr_area", false, ["ifr_low", "ifr_high"], [IFR_CHICAGO]),
];

describe("the chart pair", () => {
  it("is the overlay that belongs over the base drawn", () => {
    expect(chartPair(LAYERS, "sec").overlay?.kind).toBe("tac");
    // The Class B pin resolved the TAC whatever the base, and named it
    // over an IFR base while the map drew the IFR area chart.
    expect(chartPair(LAYERS, "ifr_low").overlay?.kind).toBe("ifr_area");
  });

  it("falls back to the sectional, and its overlay, for a base the course has no layer of", () => {
    const pair = chartPair(LAYERS, "ifr_high");
    expect(pair.base?.kind).toBe("sec");
    expect(pair.overlay?.kind).toBe("tac");
  });

  it("finds the sheet under a point, and none away from every sheet", () => {
    const ord = [41.98, -87.9] as const;
    expect(sheetAt(chartPair(LAYERS, "sec").overlay, ...ord)?.label).toBe("Chicago TAC");
    expect(sheetAt(chartPair(LAYERS, "ifr_low").overlay, ...ord)?.label).toBe("IFR area chart");
    expect(sheetAt(chartPair(LAYERS, "sec").overlay, 46.8, -92.2)).toBeNull();
  });
});

describe("the tiles a view needs", () => {
  it("are the screen's worth round its middle, nearest the middle first", () => {
    // A phone's 402 by 874 points, its middle at (1000, 1000) in the
    // level's pixels: columns 3 and 4, rows 2 to 5.
    const tiles = tilesAround({ x: 1000, y: 1000 }, { x: 201, y: 437 });
    expect(tiles).toHaveLength(8);
    expect(tiles[0]).toEqual([3, 3]);
    expect(tiles.map(([x]) => x).sort()).toEqual([3, 3, 3, 3, 4, 4, 4, 4]);
    expect(new Set(tiles.map(([, y]) => y))).toEqual(new Set([2, 3, 4, 5]));
  });

  it("leave the columns past the antimeridian to the asker, which wraps them", () => {
    expect(tilesAround({ x: 10, y: 128 }, { x: 100, y: 10 })).toEqual([[0, 0], [-1, 0]]);
  });
});

describe("the level a zoom is asked for ahead at", () => {
  const sec = { min_zoom: 3, max_zoom: 12 };
  const tac = { min_zoom: 10, max_zoom: 13 };

  it("is the level it goes to, for a zoom of more than a level, in or out", () => {
    expect(levelAhead(7, 10, sec)).toBe(10);
    expect(levelAhead(9, 7, sec)).toBe(7);
    // A route fitted at a quarter level: a level and a quarter in.
    expect(levelAhead(8.75, 10, sec)).toBe(10);
  });

  it("is none for a zoom of a level or less, which Leaflet asks for itself as it starts", () => {
    expect(levelAhead(7, 8, sec)).toBeNull();
    expect(levelAhead(9.25, 10, sec)).toBeNull();
    expect(levelAhead(8, 7, sec)).toBeNull();
  });

  it("is the chart's last level past it, where the chart is drawn enlarged", () => {
    expect(levelAhead(7, 14, sec)).toBe(12);
    // From 13 to 11: from the last level drawn, 12, a level out.
    expect(levelAhead(13, 11, sec)).toBeNull();
    expect(levelAhead(14, 10, sec)).toBe(10);
  });

  it("is none below the layer's first level, where it draws nothing", () => {
    expect(levelAhead(7, 9, tac)).toBeNull();
    expect(levelAhead(7, 10, tac)).toBe(10);
  });
});

describe("the tiles fetched ahead", () => {
  // Idle turns run by hand; each fetch() takes 2 ms of a clock kept here.
  const rig = (deadline: IdleDeadline | null = null) => {
    let clock = 0;
    const got: [string, string][] = [];
    const turns: ((d: IdleDeadline | null) => void)[] = [];
    const idle: IdleRun = go => {
      turns.push(go);
      return () => { turns.splice(turns.indexOf(go), 1); };
    };
    const prefetch = new TilePrefetch(100, (url, priority) => { got.push([url, priority]); clock += 2; }, idle, () => clock);
    const turn = () => turns.shift()!(deadline);
    return { prefetch, got, turns, turn };
  };
  const urls = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `t${from + i}`);

  it("asks for a zoom's own level at once, at high priority", () => {
    const { prefetch, got, turns } = rig();
    prefetch.now(urls(3));
    expect(got).toEqual([["t0", "high"], ["t1", "high"], ["t2", "high"]]);
    expect(turns).toHaveLength(0);
  });

  it("asks for the ring a slice at a time when idle, at low priority", () => {
    const { prefetch, got, turns, turn } = rig();
    prefetch.later(urls(10));
    expect(got).toHaveLength(0);
    const perSlice = PREFETCH_SLICE_MS / 2;
    turn();
    expect(got).toHaveLength(perSlice);
    expect(got.every(([, p]) => p === "low")).toBe(true);
    while (turns.length) turn();
    expect(got.map(([u]) => u)).toEqual(urls(10));
  });

  it("asks one a turn at least, where the idle time left is short", () => {
    const { prefetch, got, turn } = rig({ didTimeout: false, timeRemaining: () => 0.5 });
    prefetch.later(urls(3));
    turn();
    expect(got).toHaveLength(1);
    turn();
    expect(got).toHaveLength(2);
  });

  it("asks for a tile once, however often it is asked for", () => {
    const { prefetch, got, turns, turn } = rig();
    prefetch.now(["t0"]);
    prefetch.later(urls(3));
    prefetch.later(urls(3));
    while (turns.length) turn();
    expect(got.map(([u]) => u)).toEqual(["t0", "t1", "t2"]);
  });

  it("drops what a rest the map has left has not asked for yet, and asks for it again if wanted", () => {
    const { prefetch, got, turns, turn } = rig();
    prefetch.later(urls(10));
    turn();
    const first = got.length;
    prefetch.drop();
    expect(turns).toHaveLength(0);
    expect(got).toHaveLength(first);
    prefetch.later(urls(10));
    while (turns.length) turn();
    expect(got.map(([u]) => u)).toEqual(urls(10));
  });
});
