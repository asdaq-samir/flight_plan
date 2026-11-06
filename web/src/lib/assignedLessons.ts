import type { ApproachLesson, ProcedureDrawing } from "./api/types";
import { approachFixes } from "./approachLesson";
import { said } from "./endorsements";
import type { PickedProcedure } from "./procedures";

/**
 * Approaches an instructor set as lessons (springboot's LessonService),
 * read the same way on both sides: how far the student has come, the
 * quiz's score, the day it is due, the instructor's note at a fix, and
 * the approach to open the lesson on.
 */

/** The quiz as far as answered: right of answered, of how many. */
export interface QuizScore {
  right: number;
  answered: number;
  of: number;
}

export function quizScore(lesson: Pick<ApproachLesson, "quizAnswers" | "quizOf">): QuizScore | null {
  if (lesson.quizOf == null) return null;
  return { right: lesson.quizAnswers.filter(a => a.right).length, answered: lesson.quizAnswers.length, of: lesson.quizOf };
}

/** Where the student is with it, in a word or a score: "Not started",
 *  "Briefed", "Flown", "Quiz 6 of 8", or a quiz part answered "Quiz 2 of
 *  8 answered, 1 right". */
export function lessonStatus(lesson: Pick<ApproachLesson, "status" | "quizAnswers" | "quizOf">): string {
  const score = quizScore(lesson);
  if (score) {
    return score.answered >= score.of
      ? `Quiz ${score.right} of ${score.of}`
      : `Quiz ${score.answered} of ${score.of} answered, ${score.right} right`;
  }
  if (lesson.status === "flown") return "Flown";
  if (lesson.status === "briefed") return "Briefed";
  return "Not started";
}

/** "Due 8 Nov 2026", or "Overdue since 8 Nov 2026" while its quiz is not
 *  all answered past that day; none without a day. `today` the pilot's
 *  own, as lib/clock's localDay writes it. */
export function dueWords(lesson: Pick<ApproachLesson, "dueOn" | "quizAnswers" | "quizOf">, today: string): string | null {
  if (!lesson.dueOn) return null;
  const score = quizScore(lesson);
  const done = !!score && score.answered >= score.of;
  return !done && lesson.dueOn < today ? `Overdue since ${said(lesson.dueOn)}` : `Due ${said(lesson.dueOn)}`;
}

/** The instructor's note at a fix, whatever its case; none where they left none. */
export function noteAt(notes: Record<string, string> | null | undefined, fix: string | null | undefined): string | null {
  if (!notes || !fix) return null;
  const key = fix.toUpperCase();
  return Object.entries(notes).find(([k]) => k.toUpperCase() === key)?.[1] ?? null;
}

/** The fixes a note may be left at: the approach's own, in the order
 *  flown, each once (its missed approach's left out, as the brief's). */
export function notableFixes(drawing: ProcedureDrawing): string[] {
  return [...new Set(approachFixes(drawing).map(f => f.ident))];
}

/** The notes as sent: each fix's words trimmed, the blank ones left out. */
export function notesToSend(typed: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(typed).flatMap(([fix, note]) => (note.trim() ? [[fix, note.trim()]] : [])));
}

/** The approach the lesson opens on: from vectors, as the instructor set
 *  it without a transition. */
export const lessonPicked = (lesson: Pick<ApproachLesson, "airportIdent" | "procedureId">): PickedProcedure =>
  ({ ident: lesson.airportIdent, id: lesson.procedureId, transition: null });
