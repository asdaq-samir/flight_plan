import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("sonner", () => ({
  toast: Object.assign((message: string) => { calls.push(`toast ${message}`); }, {
    success: (message: string) => { calls.push(`success ${message}`); },
    loading: (message: string) => { calls.push(`loading ${message}`); },
    dismiss: (id?: string) => { calls.push(`dismiss ${id}`); },
  }),
}));

describe("lib/toast", () => {
  it("asks for sonner only at the first toast, and makes the calls in order once it is in", async () => {
    const { toast, loadToasts } = await import("./toast");
    // Nothing to take down before any toast: sonner is not fetched for it.
    toast.dismiss("progress");
    await Promise.resolve();
    expect(calls).toEqual([]);

    toast.loading("Drawing course", { id: "progress" });
    toast.dismiss("progress");
    toast.success("Link copied");
    toast("Route changed");
    await loadToasts();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual(["loading Drawing course", "dismiss progress", "success Link copied", "toast Route changed"]);
  });
});
