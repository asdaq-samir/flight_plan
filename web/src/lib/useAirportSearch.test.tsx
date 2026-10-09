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
  api: { airportIndex: vi.fn(), airportSearch: vi.fn() },
}));

const { api } = await import("./api/client");
const { useAirportSearch } = await import("./useAirportSearch");

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.mocked(api.airportIndex).mockResolvedValue({
    airports: [["KOSH", "Wittman Regional", "Oshkosh", "WI", 1]],
  } as never);
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
