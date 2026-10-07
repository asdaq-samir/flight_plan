import { Ellipsis, Loader2, Printer, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../../components/ResponsivePopover";
import ToolbarButton from "../../../../components/ToolbarButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../../components/ui/dropdown-menu";
import { printKneeboard } from "../../../../lib/printKneeboard";
import { ScrollArea } from "../../../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { TEXT } from "../../../../lib/text";
import type { FrameworkNarrative } from "../../hooks/useNarratives";

type Framework = "langgraph" | "crewai";

const FRAMEWORK_LABEL: Record<Framework, string> = {
  langgraph: "LangGraph",
  crewai: "CrewAI",
};

/** One framework's own tab body -- the narrative as it streams in (the
 *  "generating" line only until the first words arrive), the finished
 *  text, or why there is none. Scrolls internally rather than pushing
 *  the popover past the viewport. */
function NarrativeTabBody({ framework, narrative }: { framework: Framework; narrative: FrameworkNarrative }) {
  return (
    <ScrollArea className="max-h-[60vh]">
      <div className={cn("p-3 pt-2", TEXT.prose)}>
        {narrative.loading && !narrative.text && (
          <p className="text-muted-foreground">Generating {FRAMEWORK_LABEL[framework]} narrative…</p>
        )}
        {narrative.error && <p className="text-destructive" role="alert">Narrative unavailable: {narrative.error}</p>}
        {narrative.text && <p className="whitespace-pre-wrap text-popover-foreground">{narrative.text}</p>}
      </div>
    </ScrollArea>
  );
}

interface Props {
  /** The route's sharing (PlanWorkspace's): the More menu's first items. */
  shareItems: ReactNode;
  onGenerateNarrative: (framework: Framework) => void;
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
}

/**
 * The plan's own actions beside the route, after Save -- the narrative,
 * then More -- each a toolbar button with its word under its icon:
 * "Brief", "More". More, an iOS "…", holds the route's sharing and Print,
 * at the pilot's ask: three buttons in a row beside the aeroplane and the
 * time were one too many on a phone's line.
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
export default function NavLogActions({ shareItems, onGenerateNarrative, langgraphNarrative, crewaiNarrative }: Props) {
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
    // One flex item, so the pair sits together between the drawer
    // header's other buttons -- abutting, as Save beside them and the
    // training panel's three do: each is its own 44-point hit area. A
    // gap here alone had the plan's three spaced unevenly, and was the
    // eight points the route lacked in Slide Over.
    <div className="flex items-center">
      {/* A popover from md up; on a phone a sheet from the navigation
          bar's edge, the narrative the screen's width. */}
      <ResponsivePopover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (next) ensureGenerated(tab);
        }}
      >
        <ResponsivePopoverTrigger asChild>
          {/* The panel's main action, washed in the tint as Maps' Directions
              is beside its plain buttons; More stays plain. */}
          <ToolbarButton
            text="Brief" label="Briefing narrative" data-testid="ai-narrative-button"
            className="rounded-xl bg-tint/12 hover:bg-tint/18 aria-expanded:bg-tint/18 dark:hover:bg-tint/22 pointer-coarse:px-1!"
            icon={activeNarrative.loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          />
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent title="Briefing narrative" titleHidden align="end" className="w-80 p-0 text-sm">
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
        </ResponsivePopoverContent>
      </ResponsivePopover>
      {/* Sharing, then Print: the whole briefing, or the kneeboard card --
          the nav log, radio and patterns on one half-letter page to fly
          with. Printed once the menu has gone, so it is not on the paper. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton text="More" label="Share or print" icon={<Ellipsis />} className="print:hidden" data-testid="more-actions" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56 print:hidden">
          {shareItems}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTimeout(() => window.print(), 150)} data-testid="print-briefing"><Printer />Print the briefing</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTimeout(printKneeboard, 150)} data-testid="print-kneeboard"><Printer />Print a kneeboard card</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
