// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { deviceOf, pageOf, reportOf, versionOf } from "./speed";

/** A window whose media queries answer as a device's would. */
function windowOf(matches: (query: string) => boolean, path = "/app/plan"): Window {
  return {
    matchMedia: (query: string) => ({ matches: matches(query) }),
    location: { pathname: path },
    document,
  } as unknown as Window;
}

describe("speed reports", () => {
  it("name the page by its first part under /app, and nothing after it", () => {
    expect(pageOf("/app/plan")).toBe("plan");
    expect(pageOf("/app/train/route")).toBe("train");
    expect(pageOf("/")).toBe("other");
    expect(pageOf("/app/Plan")).toBe("other");
  });

  it("tell a phone, a tablet and a desktop apart by pointer and size", () => {
    expect(deviceOf(windowOf(q => q.includes("coarse") && !q.includes("744")))).toBe("phone");
    expect(deviceOf(windowOf(q => q.includes("coarse")))).toBe("tablet");
    expect(deviceOf(windowOf(() => false))).toBe("desktop");
  });

  it("take the build from the first script's hash, or say it is vite's own server", () => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/app/assets/index-ChQRm1at.js";
    document.head.append(script);
    expect(versionOf(document)).toBe("ChQRm1at");
    script.remove();
    expect(versionOf(document)).toBe("dev");
  });

  it("round each value as the server keeps it, CLS to a thousandth", () => {
    const report = reportOf({ LCP: 1840.56, INP: 96.4, CLS: 0.01234 }, windowOf(() => false, "/app/plan"));
    expect(report).toEqual({ page: "plan", device: "desktop", version: "dev", metrics: { LCP: 1841, INP: 96, CLS: 0.012 } });
  });
});
