// @vitest-environment jsdom
/**
 * The network never runs here -- `api` is replaced with a mock, and the
 * page's own query client (with its one rule for which failures toast)
 * is used as it is. What each test proves is which query the page reads
 * a state from and whether a failure reaches the pilot as a toast, not
 * that the real planner agrees.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Course } from "../../../lib/api/types";
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

    await waitFor(() => expect(result.current.needsBuild).toEqual({ dep: "C81", dest: "KDLH" }));
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
    await waitFor(() => expect(result.current.needsBuild).not.toBeNull());

    result.current.build();

    await waitFor(() => expect(result.current.needsBuild).toBeNull());
    expect(api.checkpoints).toHaveBeenCalledTimes(2);
  });

  test("any other checkpoints failure still toasts", async () => {
    vi.mocked(api.checkpoints).mockRejectedValue(new ApiError("model-service unreachable", 502));

    const { result } = renderHook(() => usePlan(params), { wrapper });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(result.current.needsBuild).toBeNull();
  });
});
