import { describe, expect, test } from "vitest";
import { detailOf } from "./client";

const response = (status: number, body: unknown, statusText = "") =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, statusText });

describe("detailOf", () => {
  test("the planner's own sentence", async () => {
    expect(await detailOf(response(502, { detail: "aviationweather.gov did not answer" }))).toBe("aviationweather.gov did not answer");
  });

  test("FastAPI's 422 list reads as its messages, not [object Object]", async () => {
    const body = { detail: [{ loc: ["query", "depart"], msg: "Input should be a valid datetime", type: "datetime_parsing" }] };
    expect(await detailOf(response(422, body))).toBe("Input should be a valid datetime");
  });

  test("Spring's `error`, then the status text", async () => {
    expect(await detailOf(response(409, { error: "Conflict" }))).toBe("Conflict");
    expect(await detailOf(response(401, undefined, "Unauthorized"))).toBe("Unauthorized");
  });
});
