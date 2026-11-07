// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

// A fresh copy of the engine's module, not loaded yet (the setup file
// loads the shared one before every test file), and the gate over it.
async function freshEngine() {
  vi.resetModules();
  const engine = await import("./engine");
  const gate = await import("./engineGate");
  // The testing library afresh too, so it renders with the same React.
  const library = await import("@testing-library/react");
  return { ...engine, ...gate, ...library };
}

describe("the engine gate", () => {
  test("draws its placeholder until the engine is there, then what asks it", async () => {
    const { EngineGate, act, callEngine, loadEngine, render, screen } = await freshEngine();
    function Asks() {
      return <p>{callEngine("holding_leg_minutes", { altitude_ft: 16_000 })} min</p>;
    }
    render(<EngineGate fallback={<p>waiting</p>}><Asks /></EngineGate>);
    expect(screen.getByText("waiting")).toBeTruthy();
    expect(screen.queryByText(/min/)).toBeNull();
    await act(() => loadEngine(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "wingtip-engine.wasm"))));
    expect(screen.getByText("1.5 min")).toBeTruthy();
  });

  test("a call before the engine is there throws its words, naming the gate", async () => {
    const { callEngine, engineLoaded } = await freshEngine();
    expect(engineLoaded()).toBe(false);
    expect(() => callEngine("holding_leg_minutes", { altitude_ft: 3000 })).toThrow(/not loaded yet.*EngineGate/);
  });
});
