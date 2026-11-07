/**
 * The shared Rust engine (native/engine) in the browser: the very rules
 * the planner (wingtip_native) and the phones (wt_call) run, asked by name
 * with JSON in and JSON out, so an aviation rule is written once, in
 * Rust, and not again here. The module is native/wasm, built by
 * scripts/build-engine-wasm.sh into wingtip-engine.wasm beside this file
 * (committed: the web build has no Rust); native/engine/src/call.rs lists
 * the rules, and native/contract/engine.schema.json gives each one's
 * input and answer, from which contract.ts beside this file is generated
 * (`npm run types`). So a rule asked by a name the engine has not, with
 * an input not of its shape, or its answer read as another shape, is a
 * type error here rather than a surprise on the phone.
 *
 * main.tsx starts `loadEngine()` and draws at once, so the page's shell
 * paints without waiting for the .wasm; the parts that ask a rule while
 * they render wait behind an engine gate (lib/engine/engineGate) until
 * it is there, and `callEngine` stays synchronous, as the TypeScript
 * rules it replaces were. The tests load it from the file
 * (vitestSetup.ts).
 *
 * The ABI (native/wasm/src/lib.rs): wt_alloc(len) -> ptr and
 * wt_free(ptr, len) for the name and the input; wt_call(name_ptr,
 * name_len, input_ptr, input_len) -> ptr, at which a little-endian u32
 * status (0 JSON, 1 an error in words), a u32 length and the bytes;
 * wt_result_free(ptr).
 */
import wasmUrl from "./wingtip-engine.wasm?url";
import type { EngineContract } from "./contract";

/** A rule's name, as call.rs dispatches it. */
export type EngineName = keyof EngineContract;
/** What the rule `N` takes. */
export type EngineInput<N extends EngineName> = EngineContract[N]["input"];
/** What the rule `N` answers. */
export type EngineAnswer<N extends EngineName> = EngineContract[N]["answer"];

interface Exports {
  memory: WebAssembly.Memory;
  wt_alloc(len: number): number;
  wt_free(ptr: number, len: number): void;
  wt_call(namePtr: number, nameLen: number, inputPtr: number, inputLen: number): number;
  wt_result_free(ptr: number): void;
}

let engine: Exports | null = null;
let loading: Promise<void> | null = null;
let ready!: () => void;

/** Settles once the engine is loaded (by `loadEngine`). */
export const engineReady: Promise<void> = new Promise(resolve => { ready = resolve; });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The module compiled from the network, streaming where the server
 *  says application/wasm, else from its bytes: Safari and some servers
 *  (a file:// shell, a CDN with the wrong type) refuse the streaming
 *  compile, and the bytes always work. */
async function fromNetwork(url: string): Promise<WebAssembly.Instance> {
  const response = fetch(url);
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return (await WebAssembly.instantiateStreaming(response, {})).instance;
    } catch {
      // Fall through to the bytes, fetched again (the first body is used).
    }
  }
  const bytes = await (await fetch(url)).arrayBuffer();
  return (await WebAssembly.instantiate(bytes, {})).instance;
}

/**
 * Loads the engine, once: from the app's own built file, or from `bytes`
 * where given (the tests, from the file on disk). Later calls return the
 * first one's promise.
 */
export function loadEngine(bytes?: BufferSource): Promise<void> {
  loading ??= (async () => {
    const instance = bytes ? (await WebAssembly.instantiate(bytes, {})).instance : await fromNetwork(wasmUrl);
    engine = instance.exports as unknown as Exports;
    ready();
  })();
  return loading;
}

/** Whether `callEngine` can answer now. */
export function engineLoaded(): boolean {
  return engine != null;
}

/**
 * The engine's rule `name` worked on `input` (sent as JSON), its answer
 * parsed. Synchronous: it throws where the engine is not loaded yet
 * (a part not behind lib/engine/engineGate), and where the engine
 * refuses the input, with its words.
 */
export function callEngine<N extends EngineName>(name: N, input: EngineInput<N>): EngineAnswer<N> {
  const e = engine;
  // Asked before it is there: a part drawn outside its engine gate
  // (lib/engine/engineGate). Said plainly, so the stack names the caller.
  if (!e) throw new Error(`The engine is not loaded yet, so ${name} cannot be worked out: draw the part that asks it inside an EngineGate (lib/engine/engineGate).`);
  const nameBytes = encoder.encode(name);
  const inputBytes = encoder.encode(JSON.stringify(input));
  const namePtr = e.wt_alloc(nameBytes.length);
  const inputPtr = e.wt_alloc(inputBytes.length);
  let out = 0;
  try {
    // The memory's buffer is taken afresh after each call into the
    // module: an allocation that grows the memory detaches the old one.
    new Uint8Array(e.memory.buffer, namePtr, nameBytes.length).set(nameBytes);
    new Uint8Array(e.memory.buffer, inputPtr, inputBytes.length).set(inputBytes);
    out = e.wt_call(namePtr, nameBytes.length, inputPtr, inputBytes.length);
    const head = new DataView(e.memory.buffer, out, 8);
    const status = head.getUint32(0, true), len = head.getUint32(4, true);
    const text = decoder.decode(new Uint8Array(e.memory.buffer, out + 8, len));
    if (status !== 0) throw new Error(`The engine's ${name}: ${text}`);
    return JSON.parse(text) as EngineAnswer<N>;
  } finally {
    if (out) e.wt_result_free(out);
    e.wt_free(namePtr, nameBytes.length);
    e.wt_free(inputPtr, inputBytes.length);
  }
}
