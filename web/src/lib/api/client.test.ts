import { describe, expect, test } from "vitest";
import { describeError, detailOf } from "./client";

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

describe("describeError", () => {
  test("a fetch that never got an answer reads as a dropped connection, not the browser's words", () => {
    const dropped = "The connection dropped before the answer arrived";
    expect(describeError(new TypeError("Load failed"))).toBe(dropped);
    expect(describeError(new TypeError("FetchEvent.respondWith received an error: TypeError: Load failed"))).toBe(dropped);
    expect(describeError(new TypeError("Failed to fetch"))).toBe(dropped);
    expect(describeError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(dropped);
  });

  test("anything else is its own first line, or the fallback", () => {
    expect(describeError(new Error("planner service unreachable\n    at fetch"))).toBe("planner service unreachable");
    expect(describeError(new TypeError("x is not a function"))).toBe("x is not a function");
    expect(describeError("nope", "request failed")).toBe("request failed");
  });
});
