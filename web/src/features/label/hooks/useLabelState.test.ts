// @vitest-environment jsdom
/**
 * The network never runs here -- `api` is replaced with a mock, so what
 * each test actually proves is that the hook calls the right endpoint
 * with the right body and folds the response into state correctly, not
 * that the real planner-service agrees. That's still worth having: it's
 * exactly the kind of bug a rename or a dropped `await` produces, and
 * this catches it without a browser or a backend.
 */
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Course, Detection, LoosePick, StreamMessage } from "../../../lib/api/types";
import { useLabelState } from "./useLabelState";

vi.mock("../../../lib/api/client", () => ({
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

function courseFixture(): Course {
  return {
    departure: { ident: "C81", name: "Campbell", lat: 42.1, lon: -88.1, elevation_ft: 890 },
    destination: { ident: "KDLH", name: "Duluth", lat: 46.8, lon: -92.2, elevation_ft: 1428 },
    distance_nm: 323.4, bearing_deg: 328,
    course_line: [[42.1, -88.1], [46.8, -92.2]],
    max_zoom: 12, min_zoom: 4,
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
    rating: null, rated: false, along_track_nm: 40, cross_track_nm: 0, area_m2: 0, ...over,
  };
}

/** One block of detections, then done -- the shape `load` actually
 *  consumes via `for await`. */
async function* streamOf(detections: Detection[], added: LoosePick[]): AsyncGenerator<StreamMessage> {
  yield { type: "block", block: 0, blocks: 1, tiles: 1, missing: 0, detections };
  yield { type: "done", total: detections.length + added.length, added, summary: {
    total: 0, accepted: 0, rejected: 0, added: added.length, by_rating: {}, by_role: { dr: 0, visual: 0 },
  } };
}

function savedPickResponse(pick: LoosePick) {
  return { ok: true, pick, summary: {
    total: 0, accepted: 0, rejected: 0, added: 0, by_rating: {}, by_role: { dr: 0, visual: 0 },
  } };
}

function renderLabelState() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useLabelState(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLabelState", () => {
  test("load fetches the course, then streams detections and added picks in", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], [loosePickFixture()]));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });

    expect(mockCourse).toHaveBeenCalledWith("C81", "KDLH");
    expect(result.current.course?.departure.ident).toBe("C81");
    expect(result.current.detections).toHaveLength(1);
    expect(result.current.added).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test("load surfaces a failed course fetch as an error, not a thrown exception", async () => {
    mockCourse.mockRejectedValue(new Error("no such airport"));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("ZZZZ", "KDLH"); });

    expect(result.current.error).toBe("no such airport");
    expect(result.current.loading).toBe(false);
  });

  test("rate saves the pick and marks the selected detection rated", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ rating: 5, rated: true, role: "dr" })));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    act(() => result.current.select({ kind: "detected", index: 0 }));
    await act(async () => { await result.current.rate(5); });

    expect(mockSavePick).toHaveBeenCalledWith(expect.objectContaining({ rating: 5, source: "detected" }));
    expect(result.current.detections[0]!.rating).toBe(5);
    expect(result.current.detections[0]!.rated).toBe(true);
    expect(result.current.canUndo).toBe(true);
  });

  test("a rate that fails to save surfaces an error instead of silently doing nothing", async () => {
    // Every call site fires this with `void store.rate(...)`, so nothing
    // else ever sees the rejection -- this failure is only visible at
    // all through the hook's own error field.
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockRejectedValue(new Error("network error"));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    act(() => result.current.select({ kind: "detected", index: 0 }));
    await act(async () => { await result.current.rate(5); });

    expect(result.current.error).toBe("Couldn't save that rating: network error");
    // The write never landed, so the point is still unrated -- and
    // there is nothing real to step back to, unlike a genuine undo.
    expect(result.current.detections[0]!.rating).toBeNull();
    expect(result.current.canUndo).toBe(false);
  });

  test("undo reverts the most recent rate on a previously-unrated point", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));
    mockSavePick.mockResolvedValue(savedPickResponse(loosePickFixture({ rating: 3, rated: true })));
    mockDeletePick.mockResolvedValue({ ok: true, summary: {
      total: 0, accepted: 0, rejected: 0, added: 0, by_rating: {}, by_role: { dr: 0, visual: 0 },
    } });

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    act(() => result.current.select({ kind: "detected", index: 0 }));
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
    mockDeletePick.mockResolvedValue({ ok: true, summary: {
      total: 0, accepted: 0, rejected: 0, added: 0, by_rating: {}, by_role: { dr: 0, visual: 0 },
    } });
    mockSavePick.mockResolvedValue(savedPickResponse(pick));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    act(() => result.current.select({ kind: "added", index: 0 }));
    await act(async () => { await result.current.removeSelected(); });

    expect(result.current.added).toHaveLength(0);
    expect(result.current.canUndo).toBe(true);

    await act(async () => { await result.current.undo(); });

    // It had a rating before deletion, so undo re-persists the pick as
    // well as putting it back in the list.
    expect(mockSavePick).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
    expect(result.current.added).toHaveLength(1);
    expect(result.current.added[0]!.rating).toBe(4);
  });

  test("resetAll deletes every rated pick and clears the added list", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf(
      [detectionFixture({ rating: 5, rated: true }), detectionFixture({ rating: null })],
      [loosePickFixture({ rating: 2, rated: true })],
    ));
    mockDeletePick.mockResolvedValue({ ok: true, summary: {
      total: 0, accepted: 0, rejected: 0, added: 0, by_rating: {}, by_role: { dr: 0, visual: 0 },
    } });

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    await act(async () => { await result.current.resetAll(); });

    // Two rated picks in the fixture (one detection, one added) -- the
    // unrated detection never had a server-side pick, so it costs no call.
    expect(mockDeletePick).toHaveBeenCalledTimes(2);
    expect(result.current.added).toHaveLength(0);
    expect(result.current.detections.every(d => d.rating === null)).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  test("a resetAll that fails to delete surfaces an error rather than pretending it worked", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture({ rating: 5, rated: true })], []));
    mockDeletePick.mockRejectedValue(new Error("server unavailable"));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    await act(async () => { await result.current.resetAll(); });

    expect(result.current.error).toBe("Couldn't reset every rating: server unavailable");
    // The delete never landed, so the rating is left exactly as it was
    // rather than clearing it locally out of step with the server.
    expect(result.current.detections[0]!.rating).toBe(5);
  });

  test("a fresh load clears whatever the previous route left behind", async () => {
    mockCourse.mockResolvedValue(courseFixture());
    mockDetect.mockReturnValue(streamOf([detectionFixture()], []));

    const { result } = renderLabelState();
    await act(async () => { await result.current.load("C81", "KDLH"); });
    expect(result.current.detections).toHaveLength(1);

    mockDetect.mockReturnValue(streamOf([], []));
    await act(async () => { await result.current.load("KDSM", "KOMA"); });

    expect(result.current.detections).toHaveLength(0);
    expect(result.current.added).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });
});
