import { afterEach, describe, expect, test, vi } from "vitest";
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

describe("me", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The client takes its Request and fetch when the module loads, and Node
  // cannot make a Request of "/api/me" as the browser does against the
  // page, so the module is loaded afresh under both stubbed.
  const meAnswering = async (res: Response) => {
    const NodeRequest = Request;
    vi.stubGlobal("Request", class extends NodeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "http://localhost").href : input, init);
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => res));
    vi.resetModules();
    return (await import("./client")).api.me();
  };

  test("signed out, the open 204 with no body is null, not undefined", async () => {
    expect(await meAnswering(new Response(null, { status: 204 }))).toBeNull();
  });

  test("a 401, from a server before the 204, is null too", async () => {
    expect(await meAnswering(new Response(null, { status: 401, statusText: "Unauthorized" }))).toBeNull();
  });

  test("any other failure still throws", async () => {
    await expect(meAnswering(new Response(null, { status: 500, statusText: "Server Error" }))).rejects.toMatchObject({ status: 500 });
  });
});
