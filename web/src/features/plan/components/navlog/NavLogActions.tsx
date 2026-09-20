import { Loader2, Printer, Sparkles } from "lucide-react";
import { useState } from "react";
import IconButton from "../../../../components/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { ScrollArea } from "../../../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import type { FrameworkNarrative } from "../../hooks/usePlanState";

type Framework = "langgraph" | "crewai";

const FRAMEWORK_LABEL: Record<Framework, string> = {
  langgraph: "LangGraph",
  crewai: "CrewAI",
};

/** One framework's own tab body -- the narrative as it streams in (the
 *  "generating" line only until the first words arrive), the finished
 *  text, or a note that the error toast has the details. Scrolls
 *  internally rather than pushing the popover past the viewport. */
function NarrativeTabBody({ framework, narrative }: { framework: Framework; narrative: FrameworkNarrative }) {
  return (
    <ScrollArea className="max-h-[60vh]">
      <div className="p-3 pt-2">
        {narrative.loading && !narrative.text && (
          <p className="text-muted-foreground">Generating {FRAMEWORK_LABEL[framework]} narrative…</p>
        )}
        {narrative.error && <p className="text-muted-foreground">Narrative unavailable — see the error toast.</p>}
        {narrative.text && <p className="whitespace-pre-wrap text-popover-foreground">{narrative.text}</p>}
      </div>
    </ScrollArea>
  );
}

interface Props {
  onGenerateNarrative: (framework: Framework) => void;
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
}

/**
 * The nav log's own actions -- generate a briefing narrative, print
 * this -- rendered inline in PlanView's own persistent header, as
 * trailing content next to the Map/Brief tabs while Brief is the
 * active tab.
 *
 * One AI button next to Print, not two named ones -- LangGraph and
 * CrewAI live as two tabs inside the single popover it opens instead
 * of each framework claiming its own trigger in the header. Opening
 * the popover (or switching to a tab with nothing loaded yet) is what
 * actually fires that framework's own real, billed Claude call --
 * same restraint the old two-button layout had (nothing generates
 * until asked for), just behind one shared entry point instead of two.
 *
 * The narrative's own text used to have a permanent home further down
 * the page (a "Briefing Narrative" `CollapsibleSection`) -- moved into
 * this popover instead, next to the button that produces it, so
 * reading it back doesn't mean scrolling away. On screen only: a
 * closed Popover renders nothing, so `FlightBriefingView` also keeps a
 * `hidden print:block` block with whichever narrative(s) were
 * generated, for a printed copy, which needs the text sitting in the
 * page rather than behind a click a piece of paper can't make.
 */
export default function NavLogActions({ onGenerateNarrative, langgraphNarrative, crewaiNarrative }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Framework>("langgraph");
  const narratives: Record<Framework, FrameworkNarrative> = {
    langgraph: langgraphNarrative,
    crewai: crewaiNarrative,
  };
  const activeNarrative = narratives[tab];

  const ensureGenerated = (framework: Framework) => {
    const n = narratives[framework];
    if (!n.text && !n.loading) onGenerateNarrative(framework);
  };

  return (
    // A single flex item, not a bare Fragment -- PlanView's own header
    // row places this next to the Map/Brief tabs under `justify-
    // between`, which only pushes its first and last child apart and
    // spaces any child in between evenly rather than grouping it
    // against either edge. A Fragment here flattens into two top-level
    // children of that row (this Popover, then Print), landing the AI
    // button somewhere in the middle instead of flush right next to
    // Print -- wrapping both in one div is what keeps them together at
    // the row's trailing edge, the same treatment the Map view's own
    // info-button-plus-sidebar-trigger pair already gets.
    <div className="flex items-center gap-2">
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (next) ensureGenerated(tab);
        }}
      >
        <PopoverTrigger asChild>
          <IconButton label="Briefing narrative" data-testid="ai-narrative-button">
            {activeNarrative.loading ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0 text-sm">
          <Tabs
            value={tab}
            onValueChange={value => {
              const framework = value as Framework;
              setTab(framework);
              ensureGenerated(framework);
            }}
          >
            <TabsList className="mx-3 mt-3">
              <TabsTrigger value="langgraph" data-testid="langgraph-narrative-tab">LangGraph</TabsTrigger>
              <TabsTrigger value="crewai" data-testid="crewai-narrative-tab">CrewAI</TabsTrigger>
            </TabsList>
            <TabsContent value="langgraph">
              <NarrativeTabBody framework="langgraph" narrative={langgraphNarrative} />
            </TabsContent>
            <TabsContent value="crewai">
              <NarrativeTabBody framework="crewai" narrative={crewaiNarrative} />
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
      <IconButton onClick={() => window.print()} label="Print" data-testid="print-button">
        <Printer className="size-5" />
      </IconButton>
    </div>
  );
}
