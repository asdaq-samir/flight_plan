import { describe, expect, it, vi } from "vitest";
import { onToastWanted, toast, toasterMounted } from "./toast";

describe("toast, before and after the Toaster is mounted", () => {
  it("holds calls until the Toaster is mounted, then runs them in order", () => {
    const wanted = vi.fn();
    const off = onToastWanted(wanted);
    const calls: string[] = [];
    const sonner = Object.assign(
      vi.fn((m: string) => { calls.push(`plain ${m}`); }),
      {
        loading: vi.fn((m: string) => { calls.push(`loading ${m}`); }),
        success: vi.fn((m: string) => { calls.push(`success ${m}`); }),
        dismiss: vi.fn((id?: string | number) => { calls.push(`dismiss ${id}`); }),
      },
    );

    toast.loading("Saving", { id: "a" });
    toast.dismiss("a");
    toast("Undone");
    expect(wanted).toHaveBeenCalled();
    expect(calls).toEqual([]);

    toasterMounted(sonner as never);
    expect(calls).toEqual(["loading Saving", "dismiss a", "plain Undone"]);

    toast.success("Flight Saved");
    expect(calls.at(-1)).toBe("success Flight Saved");
    off();
  });
});
