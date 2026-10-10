// @vitest-environment jsdom
/**
 * A stop's search (with `fixes`) shows the airports of the phone's own
 * copy until the planner answers with the waypoints too. When that
 * request fails (offline), those airports are the answer, so Enter may
 * take the first of them.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("./api/client")>()),
  api: { airportIndex: vi.fn(), airportSearch: vi.fn(), warmAirportIndex: vi.fn() },
}));

const { api } = await import("./api/client");
const { useAirportSearch } = await import("./useAirportSearch");

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.warmAirportIndex).mockResolvedValue(true);
  vi.mocked(api.airportIndex).mockResolvedValue({
    airports: [["KOSH", "Wittman Regional", "Oshkosh", "WI", 1]],
  } as never);
});

describe("the phone's own copy", () => {
  test("is downloaded once the page is idle, and read only once the pilot goes to type", async () => {
    vi.stubGlobal("requestIdleCallback", (go: () => void) => setTimeout(go, 0));
    try {
      const { result } = renderHook(() => useAirportSearch("", true), { wrapper: wrapper() });
      await waitFor(() => expect(api.warmAirportIndex).toHaveBeenCalledTimes(1));
      expect(api.airportIndex).not.toHaveBeenCalled();
      // A field focused: the keyboard on its way up.
      const field = document.body.appendChild(document.createElement("input"));
      field.focus();
      await waitFor(() => expect(api.airportIndex).toHaveBeenCalledTimes(1));
      expect(result.current.rows).toEqual([]);
      field.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the phone's own copy, where the search is off or only typed into", () => {
  test("is neither downloaded nor read when the search is off, even with a field focused", async () => {
    vi.stubGlobal("requestIdleCallback", (go: () => void) => setTimeout(go, 0));
    const field = document.body.appendChild(document.createElement("input"));
    try {
      renderHook(() => useAirportSearch("osh", false), { wrapper: wrapper() });
      field.focus();
      await new Promise(r => setTimeout(r, 50));
      expect(api.warmAirportIndex).not.toHaveBeenCalled();
      expect(api.airportIndex).not.toHaveBeenCalled();
    } finally {
      field.remove();
      vi.unstubAllGlobals();
    }
  });

  test("is read when something is typed, with no field focused", async () => {
    renderHook(() => useAirportSearch("osh", true), { wrapper: wrapper() });
    await waitFor(() => expect(api.airportIndex).toHaveBeenCalledTimes(1));
  });
});

describe("useAirportSearch with fixes and the copy in", () => {
  test("is answered by the copy's airports once the planner's request fails", async () => {
    vi.mocked(api.airportSearch).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAirportSearch("osh", true, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    await waitFor(() => expect(result.current.answered).toBe(true));
    expect(result.current.rows[0]?.ident).toBe("KOSH");
  });

  test("is not answered while the planner's request is out", async () => {
    vi.mocked(api.airportSearch).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAirportSearch("osh", true, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(result.current.answered).toBe(false);
  });
});
