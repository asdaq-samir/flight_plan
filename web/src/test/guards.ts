// Guards against the usual causes of a flaky unit test, run before every
// test file (vite.config.ts test.setupFiles). The tests run in a random
// order (test.sequence), so whatever one test leaves behind lands on a
// different test each run; these catch it in the test that left it.
import { afterAll, afterEach, vi } from "vitest";

// Testing Library unmounts what a test rendered only when vitest's
// globals are on, which they are not here: without this, a component
// stayed mounted after its test, and its debounce timer
// (useAirportSearch's) fired after the file's jsdom was torn down, an
// unhandled error that failed whichever run it landed in. Unmounting
// runs the effects' cleanups, which clear their timers. Only in a file
// with a document (the jsdom ones); the rest never load the library.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
  lingeringTimers();
}

/**
 * The timers a file with a document leaves still to fire are cleared as
 * it ends: one firing after the file's jsdom is gone throws ("window is
 * not defined"), an unhandled error that failed whichever run it landed
 * in. Cleared, not failed: a first try that failed the file on them found
 * 7 of the 25 such files leaving some, up to 42 in one, mostly timers the
 * libraries keep rather than a test's own.
 * Real timers only; fake ones are vi's to clear.
 */
function lingeringTimers() {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const { setTimeout: set, clearTimeout: clear, setInterval: every, clearInterval: stop } = globalThis;
  globalThis.setTimeout = ((handler: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = set((...a: unknown[]) => {
      pending.delete(id);
      return typeof handler === "function" ? handler(...a) : undefined;
    }, ms, ...args);
    pending.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    if (id !== undefined) pending.delete(id);
    clear(id);
  }) as typeof clearTimeout;
  globalThis.setInterval = ((handler: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = every(handler, ms, ...args);
    pending.add(id);
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
    if (id !== undefined) pending.delete(id);
    stop(id);
  }) as typeof clearInterval;
  afterAll(() => {
    for (const id of pending) {
      clear(id);
      stop(id);
    }
    pending.clear();
  });
}

// A test that turns on fake timers turns them off again (vi.useRealTimers
// in its own afterEach or finally). Left on, the next test's setTimeout
// never fires and it times out, or its Date.now() is frozen at another
// test's clock. Its own afterEach runs before this one, so fake timers
// still on here were left on.
afterEach(() => {
  if (!vi.isFakeTimers()) return;
  const pending = vi.getTimerCount();
  vi.useRealTimers();
  throw new Error(
    `This test left fake timers on${pending ? `, with ${pending} timer(s) still pending` : ""}. ` +
      "Call vi.useRealTimers() in its afterEach (after vi.runOnlyPendingTimers() if what they do matters), " +
      "so the next test gets real ones.",
  );
});
