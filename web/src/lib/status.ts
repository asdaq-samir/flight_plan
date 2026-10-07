/**
 * What a check found, the one scale every tab of the planning panel says
 * it on: nothing against it, something to look at, something to fix
 * before the flight goes as planned, not known (not worked out for this
 * airplane, a source that did not answer), or still being worked out.
 * The words are the planner's guide, not a rule: the decision is the
 * pilot in command's (14 CFR 91.3).
 */
export type Finding = "ok" | "caution" | "stop" | "unknown" | "pending";

/** Each finding's colour for words and marks, at 4.5:1 or more on the
 *  panel in both themes (the iPhone audit's P15). */
export const FINDING_TONE: Record<Finding, string> = {
  ok: "text-green-700 dark:text-green-400",
  caution: "text-amber-700 dark:text-amber-400",
  stop: "text-red-700 dark:text-red-400",
  unknown: "text-muted-foreground",
  pending: "text-muted-foreground",
};

/** The worst of some findings: a stop over a caution over not known
 *  over still pending over nothing found. */
export function worstOf(findings: Finding[]): Finding {
  for (const f of ["stop", "caution", "unknown", "pending"] as const) if (findings.includes(f)) return f;
  return "ok";
}
