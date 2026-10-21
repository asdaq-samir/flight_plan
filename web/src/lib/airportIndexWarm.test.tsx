// @vitest-environment jsdom
/**
 * The index's bytes are asked for once the page is idle and its own
 * requests have come in (issue #214), so they do not share a phone's slow
 * link with the airports the map is waiting to label.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("./api/client")>()),
  api: { warmAirportIndex: vi.fn() },
}));

const { api } = await import("./api/client");
const { useWarmAirportIndex } = await import("./airportIndex");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.warmAirportIndex).mockResolvedValue(true);
  vi.stubGlobal("requestIdleCallback", (go: () => void) => setTimeout(go, 0));
});
afterEach(() => vi.unstubAllGlobals());

function render(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useWarmAirportIndex(true), { wrapper });
}

describe("the index's download", () => {
  test("waits while the page's own requests are in flight, and goes once they are in", async () => {
    const client = new QueryClient();
    let answer!: (v: string) => void;
    void client.prefetchQuery({ queryKey: ["airportsInView"], queryFn: () => new Promise<string>(r => { answer = r; }) });
    render(client);
    await new Promise(r => setTimeout(r, 50));
    expect(api.warmAirportIndex).not.toHaveBeenCalled();
    answer("done");
    await waitFor(() => expect(api.warmAirportIndex).toHaveBeenCalledTimes(1));
  });

  test("goes at once on a page with nothing in flight", async () => {
    render(new QueryClient());
    await waitFor(() => expect(api.warmAirportIndex).toHaveBeenCalledTimes(1));
  });

  test("goes anyway four seconds after the page is idle, if it keeps asking", async () => {
    // Real time: the hook's window.setTimeout is not the one fake timers
    // replace under jsdom.
    const client = new QueryClient();
    void client.prefetchQuery({ queryKey: ["tfrs"], queryFn: () => new Promise<string>(() => {}) });
    render(client);
    await new Promise(r => setTimeout(r, 1_000));
    expect(api.warmAirportIndex).not.toHaveBeenCalled();
    await waitFor(() => expect(api.warmAirportIndex).toHaveBeenCalledTimes(1), { timeout: 5_000 });
  }, 8_000);
});
