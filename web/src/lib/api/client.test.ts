import { describe, expect, test } from "vitest";
import { describeError, detailOf, GatewayRequest } from "./client";

describe("GatewayRequest", () => {
  test("the planner's paths go through the gateway, the query and the body as they were", async () => {
    const request = new GatewayRequest("http://localhost/api/picks?route=C81-KDLH", {
      method: "POST", body: JSON.stringify({ rating: 3 }), headers: { "Content-Type": "application/json" },
    });
    expect(request.url).toBe("http://localhost/api/planner/picks?route=C81-KDLH");
    expect(await request.json()).toEqual({ rating: 3 });
    expect(new GatewayRequest("http://localhost/api/course?next=/api/x").url).toBe("http://localhost/api/planner/course?next=/api/x");
  });
});

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
