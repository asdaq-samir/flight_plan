import { beforeEach, describe, expect, it } from "vitest";
import { LIMIT, reportOf, resetReports, sendReport } from "./errorReports";

describe("error reports", () => {
  beforeEach(resetReports);

  it("say the page's path and never its query", () => {
    const report = reportOf("error", new TypeError("x is undefined"), { pathname: "/app/plan" }, "iPhone");
    expect(report).toMatchObject({ kind: "error", message: "TypeError: x is undefined", page: "/app/plan", userAgent: "iPhone" });
    // pathname is the path alone: a magic link's ?token= is not in it.
    expect(JSON.stringify(report)).not.toContain("token");
  });

  it("cut the query off any address in the message and the stack", () => {
    const error = new TypeError("GET /api/airports/nearest?lat=41.2&lon=-87.9 failed");
    error.stack = "TypeError: boom\n    at fetch (https://x.test/api/airports/nearest?lat=41.2&lon=-87.9#top:1:2)";
    const report = reportOf("error", error, { pathname: "/" }, "");
    expect(JSON.stringify(report)).not.toMatch(/lat=|lon=|#top/);
    expect(report.message).toContain("/api/airports/nearest");
  });

  it("send each different error once, and ten at most a load", () => {
    const sent: string[] = [];
    const send = (body: string) => { sent.push(body); return true; };
    const report = (message: string) => reportOf("rejection", message, { pathname: "/app/plan" }, "iPhone");
    expect(sendReport(report("same"), send)).toBe(true);
    expect(sendReport(report("same"), send)).toBe(false);
    for (let i = 0; i < 20; i++) sendReport(report(`loop ${i}`), send);
    expect(sent).toHaveLength(LIMIT);
  });

  it("cut a long message short", () => {
    expect(reportOf("render", "x".repeat(2000), { pathname: "/" }, "").message).toHaveLength(500);
  });
});
