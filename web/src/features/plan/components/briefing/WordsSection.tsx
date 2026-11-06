import type { ReactNode } from "react";
import { cn } from "cn";
import { PillSection } from "../../../../components/Favorites";
import { Skeleton } from "../../../../components/ui/skeleton";
import { describeError } from "../../../../lib/api/client";
import { TEXT } from "../../../../lib/text";
import SourceChips from "../ask/SourceChips";
import type { WordsState } from "./wordsState";

/**
 * One section of plain-language words with the reports they rest on:
 * the Brief's risk picture, its NOTAMs and its weather (BriefWords), and
 * the debrief's what to practise (DebriefWords). Its title is the way to
 * the list in full where there is one (`onMore`, the owner's rule for
 * every section's heading), three lines of skeleton while the words are
 * written, and where the model could not be reached, "Words unavailable"
 * with the reason in the note's size and nothing else -- never a toast
 * (lib/problems). The figures the section is about stay in the Brief's
 * own cards either way.
 */
export default function WordsSection({ title, onMore, testId, state, children }: {
  title: string;
  onMore?: () => void;
  testId: string;
  state: WordsState;
  /** Under the words: the debrief's note for the instructor. */
  children?: ReactNode;
}) {
  const { answer, error, pending } = state;
  const unavailable = error ? describeError(error, "the planner did not answer") : answer?.unavailable ?? null;
  return (
    <PillSection title={title} onMore={onMore} testId={testId}>
      {pending ? (
        <div className="flex flex-col gap-2 py-0.5" aria-busy="true" data-testid={`${testId}-pending`}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : unavailable ? (
        <p className={cn("text-muted-foreground", TEXT.note)} data-testid={`${testId}-unavailable`}>Words unavailable: {unavailable}</p>
      ) : answer && (
        <>
          <p className={cn("tabular-nums", TEXT.prose)} data-testid={`${testId}-words`}>
            {answer.sentences.map((s, i) => <span key={i} data-sources={s.sources.join(" ")}>{i > 0 ? " " : ""}{s.text}</span>)}
          </p>
          {/* Eight under the chips: the next section's title reaches 8 up
              for its 44 points (PillSection), and a chip's 6 down, where
              the NOTAMs' chip lost its area's foot to the weather's title
              on CI's iPad (the iOS audit's P1, 2026-11-05). */}
          <div className="pb-2"><SourceChips sources={answer.sources} testId={`${testId}-source`} /></div>
          {children}
        </>
      )}
    </PillSection>
  );
}
