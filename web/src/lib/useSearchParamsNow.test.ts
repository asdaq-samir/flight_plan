import { describe, expect, it } from "vitest";
import { patched } from "./useSearchParamsNow";

describe("the address with some of its keys changed", () => {
  it("sets a value, takes out null and an empty string, and leaves undefined alone", () => {
    const was = new URLSearchParams("dep=C81&dest=KDLH&place=KMSN&view=briefing");
    const now = patched(was, { place: null, dest: "KOSH", stops: "", view: undefined, near: "1" });
    expect(now.toString()).toBe("dep=C81&dest=KOSH&view=briefing&near=1");
    // The address it came from as it was.
    expect(was.get("place")).toBe("KMSN");
  });
});
