import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import { TEXT } from "../../../../lib/text";
import { usePreferences, type NarrativeFramework } from "../../../../lib/preferences";
import { mayUse, useEntitlement, usesLeft } from "../../../../lib/subscription";
import PaidPrompt from "../../../../components/PaidPrompt";
import type { FrameworkNarrative } from "../../hooks/useNarratives";

const FRAMEWORK_LABEL: Record<NarrativeFramework, string> = {
  langgraph: "LangGraph",
  crewai: "CrewAI",
};

/**
 * The Brief tab's narrative, under its Go / No-Go: the flight told in
 * words by the agent the settings name (Brief, Narrative) -- LangGraph's
 * nav-log-agent or CrewAI's crewai-agent. It was the Brief button's
 * popover, then a switch over the narrative; the pilot made it a tab, and
 * the switch a setting. Each is a real, billed Claude call, so it is
 * asked for by a tap once the whole nav log is in -- Preflight, where it
 * is, is the tab up whenever the route's panel opens, and asked for on
 * opening it would bill one for every route looked at -- once a
 * framework, never again for the same plan; the text streams in under a
 * "generating" line until its first words. On screen only:
 * FlightBriefingView keeps a printed copy.
 *
 * It comes with the subscription (lib/subscription): without it, the
 * narrative's place says so (PaidPrompt) and nothing is asked for; with
 * it, what is left of the month's briefings is said under the text.
 */
export default function BriefNarrative({ ready, onGenerateNarrative, langgraphNarrative, crewaiNarrative }: {
  /** The whole nav log is in: a narrative is written from all of it. */
  ready: boolean;
  onGenerateNarrative: (framework: NarrativeFramework) => void;
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
}) {
  const framework = usePreferences(s => s.narrative);
  const narrative = framework === "langgraph" ? langgraphNarrative : crewaiNarrative;
  const [asked, setAsked] = useState<NarrativeFramework[]>([]);
  const entitlement = useEntitlement();
  const allowed = mayUse(entitlement);
  const ask = () => {
    setAsked(list => [...list, framework]);
    onGenerateNarrative(framework);
  };
  const askable = ready && allowed && !asked.includes(framework) && !narrative.text && !narrative.loading;
  const left = usesLeft(entitlement, "NARRATIVE");
  // Not offered in this deployment (lib/subscription): no section at all.
  if (entitlement.kind === "hidden") return null;
  return (
    <div className="print:hidden">
      {/* Which agent wrote it is the settings' (Brief, Narrative), not the
          heading's: "Narrative LangGraph" read as jargon to a pilot. */}
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
            <p className="text-muted-foreground" role="status">Generating the {FRAMEWORK_LABEL[framework]} narrative…</p>
          )}
          {narrative.error && <p className="text-destructive" role="alert">Narrative unavailable: {narrative.error}</p>}
          {narrative.text && <p className="whitespace-pre-wrap">{narrative.text}</p>}
          {narrative.text && <p className={cn("pt-2 text-muted-foreground", TEXT.note)}>Written by the {FRAMEWORK_LABEL[framework]} agent; Settings, Brief to change it.{left && ` ${left}.`}</p>}
        </div>
      </AccordionSection>
    </div>
  );
}
