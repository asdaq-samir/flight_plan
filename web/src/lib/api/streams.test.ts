import { describe, expect, test } from "vitest";
import { ApiError } from "./client";
import { ended, inBatches } from "./streams";

async function* lines(...messages: { type: string; detail?: string; retry?: boolean; reasons?: string[]; advice?: string }[]) {
  for (const m of messages) yield m;
}

async function drain(stream: AsyncIterable<unknown>) {
  for await (const _ of stream) { /* each line, then the failure */ }
}

describe("ended", () => {
  test("an error line the server says asking again cannot change is a client error, so it offers no Try again", async () => {
    const failure = await drain(ended(lines({ type: "stage" }, { type: "error", detail: "No legal VFR cruising altitude", retry: false }), "nav log"))
      .catch(e => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(422);
  });

  test("its reasons and advice come with it, apart from the headline, for the nav log to list", async () => {
    const failure = await drain(ended(lines({
      type: "error", detail: "No legal VFR cruising altitude 830-858 nm along the route", retry: false,
      reasons: ["The terrain and obstacles there need 10,600 ft."], advice: "Route around the high ground.",
    }), "nav log")).catch(e => e) as ApiError;
    expect(failure.message).toBe("No legal VFR cruising altitude 830-858 nm along the route");
    expect(failure.reasons).toEqual(["The terrain and obstacles there need 10,600 ft."]);
    expect(failure.advice).toBe("Route around the high ground.");
  });

  test("any other error line stays one worth asking again", async () => {
    const failure = await drain(ended(lines({ type: "error", detail: "aviationweather.gov timed out" }), "nav log")).catch(e => e);
    expect((failure as ApiError).status).toBe(200);
  });
});

describe("a stream in batches", () => {
  const timed = async function* <T>(...steps: ([number, T] | [number, Error])[]) {
    for (const [ms, value] of steps) {
      await new Promise(resolve => setTimeout(resolve, ms));
      if (value instanceof Error) throw value;
      yield value;
    }
  };

  test("hands on together the lines that come close, and apart the ones that do not", async () => {
    const got: string[][] = [];
    for await (const batch of inBatches(timed<string>([0, "a"], [5, "b"], [5, "c"], [80, "d"], [5, "e"]), 40)) got.push(batch);
    expect(got).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  test("hands on what came before a failure, then throws it", async () => {
    const got: string[][] = [];
    const run = (async () => {
      for await (const batch of inBatches(timed<string>([0, "a"], [5, "b"], [5, new Error("cut off")]), 40)) got.push(batch);
    })();
    await expect(run).rejects.toThrow("cut off");
    expect(got).toEqual([["a", "b"]]);
  });
});
