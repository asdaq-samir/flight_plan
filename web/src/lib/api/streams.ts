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
