// @vitest-environment jsdom
/**
 * The network never runs here -- `api` is replaced with a mock, so what
 * each test actually proves is that the hook calls the right endpoint
 * with the right body and lays the response and the session's edits
 * over each other correctly, not that the real planner-service agrees.
 * That's still worth having: it's exactly the kind of bug a rename or
 * a dropped `await` produces, and this catches it without a browser or
 * a backend.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Course, Detection, LoosePick, StreamMessage } from "../../../lib/api/types";
import { useTraining } from "./useTraining";

vi.mock("../../../lib/api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../lib/api/client")>()),
  api: {
    course: vi.fn(),
    detect: vi.fn(),
    savePick: vi.fn(),
    deletePick: vi.fn(),
    classify: vi.fn(),
  },
}));

const { api } = await import("../../../lib/api/client");
const mockCourse = vi.mocked(api.course);
const mockDetect = vi.mocked(api.detect);
const mockSavePick = vi.mocked(api.savePick);
const mockDeletePick = vi.mocked(api.deletePick);
const mockClassify = vi.mocked(api.classify);

function courseFixture(): Course {
  return {
    departure: { ident: "C81", name: "Campbell", lat: 42.1, lon: -88.1, elevation_ft: 890 },
    destination: { ident: "KDLH", name: "Duluth", lat: 46.8, lon: -92.2, elevation_ft: 1428 },
    distance_nm: 323.4, bearing_deg: 328,
    course_line: [[42.1, -88.1], [46.8, -92.2]],
    max_zoom: 12, min_zoom: 4, tac_max_zoom: 13, tac_min_zoom: 10, chart_cycle: "09-03-2026", chart_revision: 0, chart_tiles_base: null,
    chart_layers: [],
  };
}

function detectionFixture(over: Partial<Detection> = {}): Detection {
  return {
    lat: 43, lon: -89, category: "river", area_m2: 500, score: 4,
    along_track_nm: 25, cross_track_nm: 0, rating: null, role: null, rated: false, ...over,
  };
}

function loosePickFixture(over: Partial<LoosePick> = {}): LoosePick {
  return {
    lat: 43.5, lon: -89.5, category: "road_or_rail", role: "dr", source: "added",
    rating: null, rated: false, along_track_nm: 40, cross_track_nm: 0, area_m2: 0,
    route: "c81_kdlh", note: null, created_at: null, ...over,
  };
}

const summary = {
  total: 0, accepted: 0, rejected: 0, added: 0, by_rating: {}, by_role: { dr: 0, visual: 0 }, added_categories: [],
};

/** One block of detections, then done -- the shape the stream
 *  actually carries. */
async function* streamOf(detections: Detection[], added: LoosePick[]): AsyncGenerator<StreamMessage> {
  yield { type: "block", block: 0, blocks: 1, tiles: 1, missing: 0, detections };
  yield { type: "done", total: detections.length + added.length, added, summary: { ...summary, added: added.length } };
}

const savedPickResponse = (pick: LoosePick, displaced: { lat: number; lon: number; category: string }[] = []) => ({ ok: true, pick, summary, displaced });
const deletedResponse = { ok: true, summary };

function renderLabels(initialProps = { dep: "C81", dest: "KDLH" }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(({ dep, dest }: { dep: string; dest: string }) => useTraining(dep, dest), { wrapper, initialProps });
}

/** The course fetched and the chart read through, or failed. */
async function loaded(result: { current: { loading: boolean } }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTraining", () => {
  test("fetches the course, then streams detections and added picks in", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], [loosePickFixture()]));

    const { result } = renderLabels();
    await loaded(result);

    expect(mockCourse).toHaveBeenCalledWith("C81", "KDLH");
    expect(result.current.course?.departure.ident).toBe("C81");
    expect(result.current.endpoints).toHaveLength(2);
    expect(result.current.detections).toHaveLength(1);
    expect(result.current.added).toHaveLength(1);
  });

  test("a failed course fetch is an error to show, not a thrown exception", async () => {
    mockCourse.mockRejectedValue(new Error("no such airport"));

    const { result } = renderLabels({ dep: "ZZZZ", dest: "KDLH" });
    await waitFor(() => expect(result.current.error).toBe("no such airport"));
    expect(result.current.loading).toBe(false);
  });

  test("keeps what arrived and shows the error line when the chart read fails part-way", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    async function* failing(): AsyncGenerator<StreamMessage> {
      yield { type: "block", block: 0, blocks: 4, tiles: 1, missing: 0, detections: [detectionFixture()] };
      yield { type: "error", detail: "corridor detection failed: tile fetch failed" };
    }
    mockDetect.mockReturnValue(failing());

    const { result } = renderLabels();
    await waitFor(() => expect(result.current.error).toBe("corridor detection failed: tile fetch failed"));
    expect(result.current.detections).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test("does not stay loading when the stream stops without done or error", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    async function* truncated(): AsyncGenerator<StreamMessage> {
      yield { type: "start", route: "c81_kdlh" };
    }
    mockDetect.mockReturnValue(truncated());

    const { result } = renderLabels();
    await waitFor(() => expect(result.current.error).toMatch(/ended before it was finished/));
    expect(result.current.loading).toBe(false);
  });

  test("rate saves the pick and marks the selected detection rated", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ rating: 5, rated: true, role: "dr" })));

    const { result } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    await act(async () => { await result.current.rate(5); });

    expect(mockSavePick).toHaveBeenCalledWith(expect.objectContaining({ rating: 5, source: "detected" }));
    expect(result.current.detections[0]!.rating).toBe(5);
    expect(result.current.detections[0]!.rated).toBe(true);
    expect(result.current.canUndo).toBe(true);
  });

  test("a rate that fails to save changes nothing on screen, and leaves nothing to undo", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockRejectedValue(new Error("network error"));

    const { result } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    await act(async () => { await result.current.rate(5); });

    // The write never landed, so the point is still unrated -- and
    // there is nothing real to step back to, unlike a genuine undo.
    expect(result.current.detections[0]!.rating).toBeNull();
    expect(result.current.canUndo).toBe(false);
  });

  test("undo reverts the most recent rate on a previously-unrated point", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ rating: 3, rated: true })));
    mockDeletePick.mockResolvedValue(deletedResponse);

    const { result } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    await act(async () => { await result.current.rate(3); });
    expect(result.current.canUndo).toBe(true);

    await act(async () => { await result.current.undo(); });

    // It had no rating before this rate() call, so undoing takes the
    // pick back off the server rather than restoring an earlier one.
    expect(mockDeletePick).toHaveBeenCalledTimes(1);
    expect(result.current.detections[0]!.rating).toBeNull();
    expect(result.current.detections[0]!.rated).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  test("removeSelected deletes an added point outright, and undo puts it back", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    const pick = loosePickFixture({ rating: 4, rated: true });
    mockDetect.mockReturnValue(streamOf([], [pick]));
    mockDeletePick.mockResolvedValue(deletedResponse);
    mockSavePick.mockResolvedValue(savedPickResponse(pick));

    const { result } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.added[0]!));
    await act(async () => { await result.current.removeSelected(); });

    expect(result.current.added).toHaveLength(0);
    expect(result.current.canUndo).toBe(true);

    await act(async () => { await result.current.undo(); });

    // It had a rating before deletion, so undo re-persists the pick as
    // well as putting it back in the list, selected again.
    expect(mockSavePick).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
    expect(result.current.added).toHaveLength(1);
    expect(result.current.added[0]!.rating).toBe(4);
    expect(result.current.selected).toBe(result.current.added[0]);
  });

  test("resetAll deletes every rated pick and clears the added list", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf(
      [detectionFixture({ rating: 5, rated: true }), detectionFixture({ lat: 44, rating: null })],
      [loosePickFixture({ rating: 2, rated: true })],
    ));
    mockDeletePick.mockResolvedValue(deletedResponse);

    const { result } = renderLabels();
    await loaded(result);
    await act(async () => { await result.current.resetAll(); });

    // Two rated picks in the fixture (one detection, one added) -- the
    // unrated detection never had a server-side pick, so it costs no call.
    expect(mockDeletePick).toHaveBeenCalledTimes(2);
    expect(result.current.added).toHaveLength(0);
    expect(result.current.detections.every(d => d.rating === null)).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  test("a resetAll that fails to delete leaves the ratings as they were", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture({ rating: 5, rated: true })], []));
    mockDeletePick.mockRejectedValue(new Error("server unavailable"));

    const { result } = renderLabels();
    await loaded(result);
    await act(async () => { await result.current.resetAll(); });

    // The delete never landed, so the rating is left exactly as it was
    // rather than clearing it locally out of step with the server.
    expect(result.current.detections[0]!.rating).toBe(5);
  });

  test("a new route starts clean: nothing of the previous route's edits or points is left behind", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ rating: 3, rated: true })));

    const { result, rerender } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    await act(async () => { await result.current.rate(3); });
    expect(result.current.detections).toHaveLength(1);
    expect(result.current.canUndo).toBe(true);

    mockDetect.mockReturnValue(streamOf([], []));
    rerender({ dep: "KDSM", dest: "KOMA" });
    await loaded(result);

    expect(result.current.detections).toHaveLength(0);
    expect(result.current.added).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.selected).toBeNull();
  });

  test("an address naming one airport twice asks for no chart read, though the old map stays up", async () => {
    // A disabled course query still hands back the previous route's
    // course as placeholder data; the chart read keyed only on that, and
    // asked the planner for a C81->C81 corridor.
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    const { result, rerender } = renderLabels();
    await loaded(result);

    rerender({ dep: "C81", dest: "C81" });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockDetect).not.toHaveBeenCalledWith("C81", "C81", expect.anything());
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  test("a point added while the chart is still being read stays the one selected when the read ends", async () => {
    // The read's own unclaimed picks arrive only with its last message,
    // and go in front of the points added by hand. The selection was a
    // position in that list, so it slid onto one of them, and the next
    // rating was saved to the wrong pick.
    mockCourse.mockResolvedValue(courseFixture());
    let finish!: () => void;
    const unclaimed = loosePickFixture({ lat: 45.5, lon: -91.5 });
    mockDetect.mockReturnValue((async function* (): AsyncGenerator<StreamMessage> {
      yield { type: "block", block: 0, blocks: 2, tiles: 1, missing: 0, detections: [detectionFixture()] };
      await new Promise<void>(resolve => { finish = resolve; });
      yield { type: "done", total: 2, added: [unclaimed], summary: { ...summary, added: 1 } };
    })());
    mockClassify.mockResolvedValue({ category: "road_or_rail" });
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ lat: 43.25, lon: -89.25, rating: 4, rated: true })));
    const { result } = renderLabels();
    await waitFor(() => expect(result.current.detections).toHaveLength(1));

    await act(async () => { await result.current.addPick(43.25, -89.25); });
    await act(async () => { finish(); });
    await waitFor(() => expect(result.current.added).toHaveLength(2));

    expect(result.current.selected).toMatchObject({ lat: 43.25, lon: -89.25 });
    await act(async () => { await result.current.rate(4); });
    expect(mockSavePick).toHaveBeenCalledWith(expect.objectContaining({ lat: 43.25, lon: -89.25, rating: 4 }));
  });

  test("left and come back to, the page reads the chart again rather than show a stale read", async () => {
    // The session's edits go with the component; a cached read shown
    // again had every rating since then missing.
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockImplementation(() => streamOf([detectionFixture()], []));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const first = renderHook(() => useTraining("C81", "KDLH"), { wrapper });
    await loaded(first.result);
    first.unmount();
    await new Promise(resolve => setTimeout(resolve, 10));   // leaving takes longer than a tick

    const again = renderHook(() => useTraining("C81", "KDLH"), { wrapper });
    await loaded(again.result);
    expect(mockDetect).toHaveBeenCalledTimes(2);
  });

  test("a point added by hand takes the planner's distances once it is saved", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([], []));
    mockClassify.mockResolvedValue({ category: "road_or_rail" });
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({
      lat: 43.25, lon: -89.25, rating: 3, rated: true, along_track_nm: 61.4, cross_track_nm: 0.3,
    })));
    const { result } = renderLabels();
    await loaded(result);
    await act(async () => { await result.current.addPick(43.25, -89.25); });
    expect(result.current.added[0]!.along_track_nm).toBe(0);

    await act(async () => { await result.current.rate(3); });

    expect(result.current.added[0]).toMatchObject({ along_track_nm: 61.4, cross_track_nm: 0.3 });
  });

  test("a save that lands after the route has changed leaves the new route alone", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockImplementation(() => streamOf([detectionFixture()], []));
    let land!: () => void;
    mockSavePick.mockImplementation(() => new Promise(resolve => { land = () => resolve(savedPickResponse(loosePickFixture({ rating: 5, rated: true }))); }));
    const { result, rerender } = renderLabels();
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    let pending!: Promise<void>;
    act(() => { pending = result.current.rate(5); });

    rerender({ dep: "KDSM", dest: "KOMA" });
    await loaded(result);
    act(() => result.current.select(result.current.detections[0]!));
    await act(async () => { land(); await pending; });

    expect(result.current.selected).toBe(result.current.detections[0]);
    expect(result.current.detections[0]!.rating).toBeNull();
  });

  test("a rating that takes the place of a nearby pick shows that pick unrated, as the planner now holds it", async () => {
    // One pick per place, whatever each point is: rating the bridge took
    // the river's pick beside it, and the river still showed its rating.
    mockCourse.mockResolvedValue(courseFixture());
    const river = detectionFixture({ lat: 43, lon: -89, category: "river", rating: 4, rated: true });
    const bridge = detectionFixture({ lat: 43.0005, lon: -89, category: "road_or_rail" });
    mockDetect.mockReturnValue(streamOf([river, bridge], []));
    mockSavePick.mockResolvedValue(savedPickResponse(
      loosePickFixture({ lat: 43.0005, lon: -89, category: "road_or_rail", rating: 5, rated: true }),
      [{ lat: 43, lon: -89, category: "river" }],
    ));
    const { result } = renderLabels();
    await loaded(result);

    act(() => result.current.select(result.current.detections[1]!));
    await act(async () => { await result.current.rate(5); });

    expect(result.current.detections[0]).toMatchObject({ category: "river", rating: null, rated: false });
    expect(result.current.detections[1]).toMatchObject({ rating: 5, rated: true });
  });
});
