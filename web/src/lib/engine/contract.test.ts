import { readFileSync } from "node:fs";
import { compile, type JSONSchema } from "json-schema-to-typescript";
import { describe, expect, it } from "vitest";

// The engine's contract (native/contract/engine.schema.json) and the
// types made from it (contract.ts, by `npm run types`). The engine's own
// check, native/engine/tests/contract.rs, holds the engine to the schema;
// this holds the web's types to it, so the three never drift apart.
const schema = JSON.parse(readFileSync(new URL("../../../../native/contract/engine.schema.json", import.meta.url), "utf8")) as JSONSchema & {
  properties: Record<string, unknown>;
  required: string[];
};
const generated = readFileSync(new URL("./contract.ts", import.meta.url), "utf8");

/** The members of the generated EngineContract interface, in order. */
function generatedNames(text: string): string[] {
  const start = text.indexOf("export interface EngineContract {");
  expect(start).toBeGreaterThanOrEqual(0);
  const body = text.slice(start, text.indexOf("\n}\n", start));
  return [...body.matchAll(/^ {2}([a-z0-9_]+): \{$/gm)].map(m => m[1]!);
}

/** Whitespace aside: prettier's line breaks are not the contract. */
const words = (text: string) => text.replace(/\s+/g, " ").trim();

describe("the engine's contract", () => {
  it("names every rule once, each with an input and an answer", () => {
    const names = Object.keys(schema.properties);
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
    expect([...schema.required].sort()).toEqual([...names].sort());
  });

  it("is what contract.ts was generated from: the same names, the same types", async () => {
    expect(generatedNames(generated)).toEqual(Object.keys(schema.properties));
    const again = await compile(schema, "EngineContract", {
      additionalProperties: false,
      unreachableDefinitions: true,
      bannerComment: "",
    });
    const banner = generated.slice(0, generated.indexOf("*/") + 2);
    expect(words(generated.slice(banner.length))).toBe(words(again));
    // 30 s, not vitest's 5: the schema is compiled and run through prettier
    // here, a CPU-bound second or so alone that took 6.6 s on a loaded Mac
    // and timed out. Unformatted it is a quarter of a second but not the
    // same text (prettier drops brackets and adds semicolons), and a test
    // that waits on nothing outside cannot hang, so a longer limit costs
    // nothing.
  }, 30_000);
});
