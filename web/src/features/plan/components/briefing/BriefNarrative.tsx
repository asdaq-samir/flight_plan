import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import { TEXT } from "../../../../lib/text";
import { mayUse, useEntitlement, usesLeft } from "../../../../lib/subscription";
import PaidPrompt from "../../../../components/PaidPrompt";
import type { Narrative } from "../../hooks/useNarrative";

/**
 * The Brief tab's narrative, under its Go / No-Go: the flight told in
 * words by Claude, from the whole nav log (the planner's
 * /api/briefing/narrative). It is a real, billed Claude call, so it is
 * asked for by a tap once the whole nav log is in -- Preflight, where it
 * is, is the tab up whenever the route's panel opens, and asked for on
 * opening it would bill one for every route looked at -- once, never
 * again for the same plan; the text streams in under a "generating" line
 * until its first words. On screen only: FlightBriefingView keeps a
 * printed copy.
 *
 * It comes with the subscription (lib/subscription): without it, the
 * narrative's place says so (PaidPrompt) and nothing is asked for; with
 * it, what is left of the month's briefings is said under the text.
 */
export default function BriefNarrative({ ready, onGenerateNarrative, narrative }: {
  /** The whole nav log is in: a narrative is written from all of it. */
  ready: boolean;
  onGenerateNarrative: () => void;
  narrative: Narrative;
}) {
  const [asked, setAsked] = useState(false);
  const entitlement = useEntitlement();
  const allowed = mayUse(entitlement);
  const ask = () => {
    setAsked(true);
    onGenerateNarrative();
  };
  const askable = ready && allowed && !asked && !narrative.text && !narrative.loading;
  const left = usesLeft(entitlement, "NARRATIVE");
  // Not offered in this deployment (lib/subscription): no section at all.
  if (entitlement.kind === "hidden") return null;
  return (
    <div className="print:hidden">
      <AccordionSection title="Narrative">
        <div aria-label="Briefing narrative" data-testid="brief-narrative">
          {!allowed && !narrative.text && (
            <PaidPrompt feature="NARRATIVE">The flight told in a page of plain words, from the whole nav log and the weather.</PaidPrompt>
          )}
          {allowed && !ready && !narrative.text && (
            <p>Written from the whole nav log, once it is in.</p>
          )}
          {askable && (
            <Button variant="outline" onClick={ask} data-testid="brief-narrative-write">Write it</Button>
          )}
          {narrative.loading && !narrative.text && (
            <p className="text-muted-foreground" role="status">Generating the narrative…</p>
          )}
          {narrative.error && <p className="text-destructive" role="alert">Narrative unavailable: {narrative.error}</p>}
          {narrative.text && <p className="whitespace-pre-wrap">{narrative.text}</p>}
          {/* What is left of the month's briefings, under the text. */}
          {narrative.text && left && <p className={cn("pt-2 text-muted-foreground", TEXT.note)}>{left}.</p>}
        </div>
      </AccordionSection>
    </div>
  );
}
