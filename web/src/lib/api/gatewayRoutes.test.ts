import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every planner endpoint the web app asks for is one the gateway forwards
 * (springboot's PlannerProxyController ROUTES, the list of what the
 * browser may reach): a path left off it is a 404 there, and the
 * runway's forecast wind (forecast-wind) and an airplane's alert state
 * (traffic status) had been for as long as they were asked for, with
 * every spec passing on its own stub (2026-10-21).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function gatewayRoutes(): { method: string; pattern: RegExp }[] {
  const java = read("../../../../springboot-app/src/main/java/com/northflyers/vfr/controller/PlannerProxyController.java");
  const constants = new Map([...java.matchAll(/static final String (\w+) = "([^"]*)";/g)].map(m => [m[1]!, m[2]!]));
  return [...java.matchAll(/route\("(\w+)", ((?:\w+ \+ )?"[^"]*"|\w+)\)/g)].map(m => {
    const path = m[2]!.split(" + ").map(part => (part.startsWith('"') ? part.slice(1, -1) : constants.get(part) ?? part)).join("");
    const pattern = path.split(/\{[^}]+\}/).map(s => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&")).join("[^/]+");
    return { method: m[1]!, pattern: new RegExp(`^${pattern}$`) };
  });
}

describe("the gateway", () => {
  it("forwards every planner endpoint the web app asks for", () => {
    const asked = [...read("./client.ts").matchAll(/planner\.(GET|POST|DELETE)\("([^"]+)"/g)].map(m => ({ method: m[1]!, path: m[2]! }));
    expect(asked.length).toBeGreaterThan(30);
    const routes = gatewayRoutes();
    const missing = asked.filter(({ method, path }) =>
      !routes.some(r => r.method === method && r.pattern.test(path.replace(/\{[^}]+\}/g, "X"))));
    expect(missing).toEqual([]);
  });
});
