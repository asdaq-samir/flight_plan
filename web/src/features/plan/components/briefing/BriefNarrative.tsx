import { useEffect, useRef } from "react";
import { TEXT } from "../../../../lib/text";
import { usePreferences, type NarrativeFramework } from "../../../../lib/preferences";
import type { FrameworkNarrative } from "../../hooks/useNarratives";

const FRAMEWORK_LABEL: Record<NarrativeFramework, string> = {
  langgraph: "LangGraph",
  crewai: "CrewAI",
};

/**
 * The Brief tab's first part: the briefing narrative, written by the
 * agent the settings name (Brief, Narrative) -- LangGraph's nav-log-agent
 * or CrewAI's crewai-agent. It was the Brief button's popover, then a
 * switch over the narrative; the pilot made it a tab, and the switch a
 * setting. Each is a real, billed Claude call, so it is asked for once
 * the tab is open and the whole nav log is in -- once a framework, never
 * again for the same plan; the text streams in under a "generating" line
 * until its first words. On screen only: FlightBriefingView keeps a
 * printed copy.
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
  const asked = useRef(new Set<NarrativeFramework>());
  useEffect(() => {
    if (!ready || asked.current.has(framework) || narrative.text || narrative.loading) return;
    asked.current.add(framework);
    onGenerateNarrative(framework);
  }, [ready, framework, narrative.text, narrative.loading, onGenerateNarrative]);
  return (
    <section className={`border-b py-4 print:hidden ${TEXT.prose}`} aria-label="Briefing narrative" data-testid="brief-narrative">
      {!ready && !narrative.text && (
        <p className="text-muted-foreground">Written from the whole nav log, once it is in.</p>
      )}
      {narrative.loading && !narrative.text && (
        <p className="text-muted-foreground">Generating {FRAMEWORK_LABEL[framework]} narrative…</p>
      )}
      {narrative.error && <p className="text-destructive" role="alert">Narrative unavailable: {narrative.error}</p>}
      {narrative.text && <p className="whitespace-pre-wrap">{narrative.text}</p>}
    </section>
  );
}
