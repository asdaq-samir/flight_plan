import { ApiError } from "./client";

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
      const detail = (msg as { detail?: string }).detail ?? `${what} failed`;
      throw new ApiError(detail.split("\n")[0] ?? detail, 200);
    }
    if (msg.type === "done") finished = true;
    yield msg;
  }
  if (!finished) throw new ApiError(`the ${what} ended before it was finished`, 200);
}
