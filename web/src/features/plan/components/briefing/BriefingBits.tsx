import type { ReactNode } from "react";
import { cn } from "cn";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { GROUP_HEADING, TEXT } from "../../../../lib/text";
import { altFt } from "../../format";
import { passLine, type SuaWhen, type TfrWhen } from "../../../../lib/passTimes";
import { FINDING_TONE, type Finding } from "../../../../lib/status";

// The small pieces the briefing's parts share (FlightBriefingView).

/**
 * Whichever narrative(s) a pilot actually generated, print only. On
 * screen each is the Brief tab's (BriefNarrative), whose framework
 * switch is no use on paper, so a printed copy has its own text sitting
 * directly in the page. Prints neither,
 * one, or both, whichever the pilot actually asked for on screen --
 * generating a framework's narrative just to have it for a printout
 * nobody asked for would be a real, billed Claude call spent on
 * nothing.
 */
export function BriefingNarrativePrintBlock({ langgraph, crewai }: { langgraph: string | null; crewai: string | null }) {
  if (!langgraph && !crewai) return null;
  // On paper only, at paper's own 14: no finger, no type scale.
  return (
    <div className="hidden break-inside-avoid-page border-b border-border px-4 py-3 print:block print:break-inside-avoid">
      {langgraph && (
        <>
          <h2 className={GROUP_HEADING}>Narrative</h2>
          <p className={cn("mt-2 text-muted-foreground", TEXT.detail)}>{langgraph}</p>
        </>
      )}
      {crewai && (
        <>
          <h2 className={cn(GROUP_HEADING, langgraph && "mt-3")}>
            Second narrative
          </h2>
          <p className={cn("mt-2 text-muted-foreground", TEXT.detail)}>{crewai}</p>
        </>
      )}
    </div>
  );
}

/** The altitude range a hazard covers, worded around whichever bound
 *  is actually known -- an advisory with no upper limit reported (or
 *  no lower one) is common, and "—-35,000 ft" reads like a typo. */
export function hazardAltitudeRange(lowFt: number | null, highFt: number | null): string | null {
  if (lowFt == null && highFt == null) return null;
  if (lowFt == null) return `up to ${altFt(highFt)} ft`;
  if (highFt == null) return `${altFt(lowFt)} ft and above`;
  return `${altFt(lowFt)}-${altFt(highFt)} ft`;
}

/** What a special-use area's times of use say for the pass (lib/passTimes). */
export const SUA_WORDS: Record<SuaWhen, string> = {
  "active": "scheduled in use then",
  "by-notam": "not scheduled then, but a NOTAM can activate it",
  "not-scheduled": "not scheduled then",
  "unknown": "read its times against yours",
};
export const SUA_FINDING: Record<SuaWhen, Finding> = {
  "active": "stop",
  "by-notam": "caution",
  "not-scheduled": "ok",
  "unknown": "caution",
};
export const TFR_WORDS: Record<TfrWhen, string> = {
  "in-force": "in force then",
  "before": "before it starts",
  "after": "after it ends",
};

/** When the flight gets to a TFR, and whether it is in force then: red
 *  where it is. */
export function PassNote({ when }: { when: { pass: Date; state: TfrWhen } | null }) {
  if (!when) return null;
  return (
    <span className={cn("block", when.state === "in-force" && cn("font-semibold", FINDING_TONE.stop))} data-testid="tfr-pass">
      {`You pass about ${passLine(when.pass)}, ${TFR_WORDS[when.state]}`}
    </span>
  );
}

/** A warning on a section's title, seen before its content: in red for
 *  what stops the flight as planned, amber for what to look at. */
export function Flag({ finding, testId, children }: { finding: "stop" | "caution"; testId: string; children: ReactNode }) {
  const Icon = finding === "stop" ? OctagonAlert : TriangleAlert;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold", FINDING_TONE[finding], TEXT.note)} data-testid={testId}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

/** A section's line while what it shows is still coming, or failed. */
export function Pending({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground" role="status">{children}</p>;
}
