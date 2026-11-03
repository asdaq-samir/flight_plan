// The engine for the unit tests (vite.config.ts test.setupFiles): from
// the committed file's bytes, as Node has no fetch of a Vite asset URL,
// so a test of a rule that calls the engine tests the engine itself.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./engine";

// A path, not a URL object: under jsdom (debrief.test.ts) URL is jsdom's,
// which node:fs does not take.
await loadEngine(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "wingtip-engine.wasm")));
