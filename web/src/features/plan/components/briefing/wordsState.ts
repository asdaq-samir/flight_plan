import type { WordsAnswer } from "../../../../lib/api/words";

/** Where a reading stands (WordsSection): still being written, could not
 *  be had, or in. A module of its own, so the section's file keeps fast
 *  refresh. */
export interface WordsState {
  answer: WordsAnswer | null | undefined;
  error: unknown;
  /** Nothing in and nothing failed: the skeleton. */
  pending: boolean;
}

/** A query's result as the section reads it. */
export const wordsState = (q: { data?: WordsAnswer | null; error: unknown }): WordsState =>
  ({ answer: q.data, error: q.error, pending: !q.data && !q.error });

