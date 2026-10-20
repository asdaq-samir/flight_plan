import { ApiError } from "./client";
import type { Detour } from "./types";

/**
 * A stream that must end with `done`: an `error` line is the server's
 * own failure, thrown as one so the query fails and what arrived
 * before it stays on screen; a stream that stops without either was
 * cut off in transit, and the page must not sit on "loading" for it.
 * Used with TanStack Query's streamed query, which keeps every line
 * before the throw.
 */
export async function* ended<T extends { type: string }>(stream: AsyncIterable<T>, what: string): AsyncGenerator<T> {
  let finished = false;
  for await (const msg of stream) {
    if (msg.type === "error") {
      const { detail = `${what} failed`, retry, reasons = [], advice = null, class_b = false, detours = [], brief = null } =
        msg as { detail?: string; retry?: boolean; reasons?: string[]; advice?: string | null; class_b?: boolean; detours?: Detour[]; brief?: string | null };
      // A failure asking again cannot change (a route with no legal
      // altitude) as the client error it is: no Try again (queryClient).
      // Its reasons and advice come with it, for the nav log to list.
      throw new ApiError(detail.split("\n")[0] ?? detail, retry !== false ? 200 : 422, reasons, advice, class_b, detours, brief);
    }
    if (msg.type === "done") finished = true;
    yield msg;
  }
  if (!finished) throw new ApiError(`the ${what} ended before it was finished`, 200);
}

/** How long a stream's lines are gathered before they are handed on, ms. */
export const BATCH_MS = 120;

/**
 * A stream's lines handed on in batches: the ones that come within
 * `windowMs` of the first, together. Each line was a render of the whole
 * route panel -- the nav log's thirty-odd, one after another, each 60 to
 * 85 ms of a phone's (the 19 Oct audit), so the app stopped answering a
 * tap for the seconds a plan took, the owner's "why does the app become
 * unresponsive". Lines before a failure are handed on before it is
 * thrown, as the streamed query keeps them.
 */
export async function* inBatches<T>(stream: AsyncIterable<T>, windowMs = BATCH_MS): AsyncGenerator<T[]> {
  const it = stream[Symbol.asyncIterator]();
  const later = Symbol("later");
  let next: Promise<IteratorResult<T>> | null = null;
  let batch: T[] = [];
  let opened = 0;
  try {
    for (;;) {
      next ??= it.next();
      let got: IteratorResult<T> | typeof later;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        got = batch.length
          ? await Promise.race([next, new Promise<typeof later>(resolve => { timer = setTimeout(() => resolve(later), Math.max(0, opened + windowMs - Date.now())); })])
          : await next;
      } catch (err) {
        if (batch.length) yield batch;
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (got === later) {
        yield batch;
        batch = [];
        continue;
      }
      next = null;
      if (got.done) break;
      if (!batch.length) opened = Date.now();
      batch.push(got.value);
    }
    if (batch.length) yield batch;
  } finally {
    await it.return?.();
  }
}
