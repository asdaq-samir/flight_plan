import { describe, expect, test } from "vitest";
import { ApiError } from "./client";
import { ended } from "./streams";

async function* lines(...messages: { type: string; detail?: string; retry?: boolean }[]) {
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

  test("any other error line stays one worth asking again", async () => {
    const failure = await drain(ended(lines({ type: "error", detail: "aviationweather.gov timed out" }), "nav log")).catch(e => e);
    expect((failure as ApiError).status).toBe(200);
  });
});
