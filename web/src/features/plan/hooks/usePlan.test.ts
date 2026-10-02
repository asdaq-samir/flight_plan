// @vitest-environment jsdom
/**
 * The network never runs here -- `api` is replaced with a mock, and the
 * page's own query client (with its one rule for which failures toast)
 * is used as it is. What each test proves is which query the page reads
 * a state from and whether a failure reaches the pilot as a toast, not
 * that the real planner agrees.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CheckpointDescriptionMessage, Course } from "../../../lib/api/types";
import { queryClient } from "../../../lib/queryClient";
import { usePlan, type PlanParams } from "./usePlan";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), custom: vi.fn(), dismiss: vi.fn() }) }));

vi.mock("../../../lib/api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../lib/api/client")>()),
  api: {
    course: vi.fn(),
    checkpoints: vi.fn(),
    navlog: vi.fn(),
    briefing: vi.fn(),
    describeCheckpoints: vi.fn(),
    saveCheckpointNote: vi.fn(),
    frameworkNarrative: vi.fn(),
    me: vi.fn(),
  },
}));

const { api, ApiError } = await import("../../../lib/api/client");
const { toast } = await import("sonner");

function courseFixture(): Course {
  return {
    departure: { ident: "C81", name: "Campbell", lat: 42.1, lon: -88.1, elevation_ft: 890, kind: "airport" },
    destination: { ident: "KDLH", name: "Duluth", lat: 46.8, lon: -92.2, elevation_ft: 1428, kind: "airport" },
    stops: [],
    distance_nm: 323.4, bearing_deg: 328,
    course_line: [[42.1, -88.1], [46.8, -92.2]],
    max_zoom: 12, min_zoom: 4, chart_cycle: "09-03-2026", chart_revision: 0, chart_tiles_base: null,
    chart_layers: [],
  };
}

const params: PlanParams = {
  dep: "C81", dest: "KDLH", stops: [], altitudeFt: "", altitudeChoice: "lowest", depart: "",
  aircraft: { profile: "c172", label: "Cessna 172" }, load: 0,
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

beforeEach(() => {
  vi.mocked(api.course).mockResolvedValue(courseFixture());
  vi.mocked(api.briefing).mockReturnValue(new Promise(() => {}));   // never answers; not what these tests are about
  vi.mocked(api.checkpoints).mockReturnValue(new Promise(() => {}));
  vi.mocked(api.me).mockResolvedValue(null);
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

/** One generated line per point, the way the notes stream carries them. */
async function* notesStream(lines: [number, number, string][]): AsyncGenerator<CheckpointDescriptionMessage> {
  yield { type: "start", count: lines.length } as CheckpointDescriptionMessage;
  for (const [lat, lon, text] of lines) {
    yield { type: "checkpoint", lat, lon, description: text, source: "generated" } as CheckpointDescriptionMessage;
  }
}

describe("checkpoint notes", () => {
  const key = "43.00000,-89.00000";

  test("a note typed before Generate shows at once, and Generate still asks the planner", async () => {
    // Writing the edit into the stream's own cache made the query count
    // as fetched, and Generate then did nothing for that route.
    vi.mocked(api.saveCheckpointNote).mockResolvedValue(undefined as never);
    vi.mocked(api.describeCheckpoints).mockImplementation(() => notesStream([[44, -90, "the dam"]]));
    const { result } = renderHook(() => usePlan(params), { wrapper });

    await act(() => result.current.saveDescription(43, -89, "the water tower"));
    expect(result.current.descriptions[key]).toEqual({ text: "the water tower", source: "saved" });

    act(() => result.current.generateDescriptions());
    await waitFor(() => expect(result.current.descriptions["44.00000,-90.00000"]?.text).toBe("the dam"));
    expect(api.describeCheckpoints).toHaveBeenCalledTimes(1);
    expect(result.current.descriptions[key]?.text).toBe("the water tower");
  });

  test("a later generated line for the same point does not replace the pilot's edit", async () => {
    vi.mocked(api.saveCheckpointNote).mockResolvedValue(undefined as never);
    vi.mocked(api.describeCheckpoints).mockImplementation(() => notesStream([[43, -89, "a town"]]));
    const { result } = renderHook(() => usePlan(params), { wrapper });

    await act(() => result.current.saveDescription(43, -89, "the grain elevator"));
    act(() => result.current.generateDescriptions());
    await waitFor(() => expect(result.current.descriptionProgress).toBeNull());
    expect(result.current.descriptions[key]).toEqual({ text: "the grain elevator", source: "saved" });
  });

  test("a failed first save leaves nothing marked saved", async () => {
    vi.mocked(api.saveCheckpointNote).mockRejectedValue(new ApiError("planner down", 502));
    const { result } = renderHook(() => usePlan(params), { wrapper });

    await act(() => result.current.saveDescription(43, -89, "lost?").catch(() => {}));
    expect(result.current.descriptions[key]).toBeUndefined();
  });

  test("an earlier save that fails does not undo a later one that saved", async () => {
    let failFirst!: (e: Error) => void;
    vi.mocked(api.saveCheckpointNote)
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => usePlan(params), { wrapper });

    let first!: Promise<unknown>;
    act(() => { first = result.current.saveDescription(43, -89, "A").catch(() => {}); });
    await act(() => result.current.saveDescription(43, -89, "B"));
    await act(async () => { failFirst(new ApiError("timed out", 504)); await first; });

    expect(result.current.descriptions[key]).toEqual({ text: "B", source: "saved" });
  });

  test("changing the altitude keeps the notes, and asks for nothing", async () => {
    vi.mocked(api.describeCheckpoints).mockImplementation(() => notesStream([[43, -89, "the river bend"]]));
    const { result, rerender } = renderHook((p: PlanParams) => usePlan(p), { wrapper, initialProps: params });
    act(() => result.current.generateDescriptions());
    await waitFor(() => expect(result.current.descriptions[key]?.text).toBe("the river bend"));

    rerender({ ...params, altitudeFt: "5500" });

    expect(result.current.descriptions[key]?.text).toBe("the river bend");
    expect(api.describeCheckpoints).toHaveBeenCalledTimes(1);
  });

  test("after Log out the last pilot's notes are gone, and Generate asks again", async () => {
    vi.mocked(api.me).mockResolvedValue({ id: 7, displayName: "A. Pilot", email: "a@example.com", developer: false });
    vi.mocked(api.saveCheckpointNote).mockResolvedValue(undefined as never);
    vi.mocked(api.describeCheckpoints).mockImplementation(() => notesStream([]));
    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(queryClient.getQueryData(["pilot"])).toBeTruthy());
    await act(() => result.current.saveDescription(43, -89, "mine alone"));
    act(() => result.current.generateDescriptions());
    await waitFor(() => expect(api.describeCheckpoints).toHaveBeenCalledTimes(1));

    act(() => queryClient.setQueryData(["pilot"], null));   // what Log out does

    await waitFor(() => expect(result.current.descriptions[key]).toBeUndefined());
    act(() => result.current.generateDescriptions());
    await waitFor(() => expect(api.describeCheckpoints).toHaveBeenCalledTimes(2));
  });
});

describe("the briefing", () => {
  const briefingFixture = { metars: {}, weather_unavailable: [], vfr_not_recommended: [] } as never;

  test("with no course to brief, it is waiting, not loading for ever", async () => {
    vi.mocked(api.course).mockRejectedValue(new ApiError("unknown airport K", 404));
    const { result } = renderHook(() => usePlan(params), { wrapper });

    // Said as a problem that stays (lib/notify).
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());
    expect(result.current.briefing).toEqual({ state: "waiting" });
    expect(api.briefing).not.toHaveBeenCalled();
  });

  test("a refresh that fails keeps the last briefing up, and says the refresh failed", async () => {
    vi.mocked(api.briefing).mockReset();
    vi.mocked(api.briefing)
      .mockResolvedValueOnce(briefingFixture)
      .mockRejectedValue(new ApiError("aviationweather.gov did not answer", 502));
    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(result.current.briefing.state).toBe("ready"));

    await act(() => queryClient.refetchQueries({ queryKey: ["briefing"] }));

    await waitFor(() => expect(result.current.briefing).toMatchObject({
      state: "ready", data: briefingFixture, refreshError: "aviationweather.gov did not answer",
    }));
  });

  test("a first fetch that fails is failed, with the planner's reason", async () => {
    vi.mocked(api.briefing).mockReset();
    vi.mocked(api.briefing).mockRejectedValue(new ApiError("aviationweather.gov did not answer", 502));
    const { result } = renderHook(() => usePlan(params), { wrapper });

    await waitFor(() => expect(result.current.briefing).toEqual({ state: "failed", detail: "aviationweather.gov did not answer" }));
  });
});
