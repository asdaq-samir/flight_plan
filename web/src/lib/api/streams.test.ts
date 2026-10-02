import { describe, expect, test } from "vitest";
import { ApiError } from "./client";
import { ended } from "./streams";

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
