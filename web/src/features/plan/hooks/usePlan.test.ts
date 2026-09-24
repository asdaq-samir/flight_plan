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

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));

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
    startBuild: vi.fn(),
    buildStatus: vi.fn(),
    me: vi.fn(),
  },
}));

const { api, ApiError } = await import("../../../lib/api/client");
const { toast } = await import("sonner");

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

const params: PlanParams = {
  dep: "C81", dest: "KDLH", altitudeFt: "", altitudeChoice: "lowest", depart: "",
  aircraft: { profile: "c172", label: "Cessna 172" }, load: 0,
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

const notCollected = () => new ApiError("C81->KDLH has not been collected yet", 404);

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

describe("a corridor nobody has collected", () => {
  test("offers to collect it, from the checkpoints' answer, without a toast", async () => {
    // Only /api/checkpoints can say "not collected": the course resolves
    // the two airports for any route. Reading it from the course meant
    // the offer never appeared and the pilot got a bare error toast.
    vi.mocked(api.checkpoints).mockRejectedValue(notCollected());

    const { result } = renderHook(() => usePlan(params), { wrapper });

    await waitFor(() => expect(result.current.build).toEqual({ phase: "needed" }));
    expect(api.navlog).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a collect that is already done asks for the checkpoints again, and the offer goes", async () => {
    vi.mocked(api.checkpoints)
      .mockRejectedValueOnce(notCollected())
      .mockResolvedValue({ candidates: [], selected: [] } as never);
    vi.mocked(api.startBuild).mockResolvedValue({ job_id: null, state: "done" } as never);
    vi.mocked(api.navlog).mockReturnValue((async function* () {})());

    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(result.current.build.phase).toBe("needed"));

    act(() => result.current.collect());

    await waitFor(() => expect(result.current.build.phase).toBe("idle"));
    expect(api.checkpoints).toHaveBeenCalledTimes(2);
  });

  test("any other checkpoints failure still toasts", async () => {
    vi.mocked(api.checkpoints).mockReset();
    vi.mocked(api.checkpoints).mockRejectedValue(new ApiError("model-service unreachable", 502));

    const { result } = renderHook(() => usePlan(params), { wrapper });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(result.current.build.phase).toBe("idle");
  });
});

describe("collecting a route", () => {
  const job = (state: string, over: object = {}) => ({ job_id: "j1", state, step: `${state} step`, route: "C81->KDLH", ...over }) as never;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.checkpoints).mockRejectedValue(notCollected());
  });
  afterEach(() => vi.useRealTimers());

  test("queued, then running, then failed -- and Collect again starts a new one", async () => {
    vi.mocked(api.startBuild).mockResolvedValue(job("queued"));
    vi.mocked(api.buildStatus)
      .mockResolvedValueOnce(job("queued", { step: "waiting for the builds ahead of it" }))
      .mockResolvedValueOnce(job("running", { step: "collecting candidates" }))
      .mockResolvedValue(job("failed", { detail: "Overpass timed out" }));
    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(result.current.build.phase).toBe("needed"));

    act(() => result.current.collect());
    await waitFor(() => expect(result.current.build).toEqual({ phase: "queued", detail: "waiting for the builds ahead of it" }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(result.current.build.phase).toBe("running"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(result.current.build).toEqual({ phase: "failed", detail: "Overpass timed out" }));

    // It used to stay locked: the failure was the busy flag's own string.
    act(() => result.current.collect());
    await waitFor(() => expect(api.startBuild).toHaveBeenCalledTimes(2));
  });

  test("a full queue is a failure to retry, not a button locked until reload", async () => {
    vi.mocked(api.startBuild).mockRejectedValue(new ApiError("3 corridors are already waiting to be built -- try again in a few minutes", 429));
    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(result.current.build.phase).toBe("needed"));

    act(() => result.current.collect());

    await waitFor(() => expect(result.current.build.phase).toBe("failed"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a job the planner forgot (it restarted) ends as failed, and the polling stops", async () => {
    vi.mocked(api.startBuild).mockResolvedValue(job("running"));
    vi.mocked(api.buildStatus).mockRejectedValue(new ApiError("No build job j1", 404));
    const { result } = renderHook(() => usePlan(params), { wrapper });
    await waitFor(() => expect(result.current.build.phase).toBe("needed"));

    act(() => result.current.collect());
    await waitFor(() => expect(result.current.build.phase).toBe("failed"));
    const polls = vi.mocked(api.buildStatus).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.buildStatus).toHaveBeenCalledTimes(polls);
  });

  test("another route's collection does not show on this one", async () => {
    vi.mocked(api.startBuild).mockResolvedValue(job("running"));
    vi.mocked(api.buildStatus).mockResolvedValue(job("running", { step: "collecting candidates" }));
    const { result, rerender } = renderHook((p: PlanParams) => usePlan(p), { wrapper, initialProps: params });
    await waitFor(() => expect(result.current.build.phase).toBe("needed"));
    act(() => result.current.collect());
    await waitFor(() => expect(result.current.build.phase).toBe("running"));

    rerender({ ...params, dest: "KMSP" });

    await waitFor(() => expect(result.current.build.phase).toBe("needed"));
  });
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
