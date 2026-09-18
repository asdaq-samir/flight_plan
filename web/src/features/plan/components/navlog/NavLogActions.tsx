import { ChevronDown, Loader2, Printer, ScrollText, Sparkles, Square, Volume2 } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { ButtonGroup } from "../../../../components/ui/button-group";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";

interface Props {
  onGenerateNarrative: () => void;
  narrativeLoading: boolean;
  hasNarrative: boolean;
  narrative: string | null;
  onListenClick: () => void;
  listening: boolean;
}

/**
 * The nav log's own actions -- generate and listen to the briefing
 * narrative, print this -- rendered inline in `FlightBriefingView`'s
 * own title panel (alongside its own "Back to Map" button and the
 * Settings gear), not floating over the content the way this component
 * used to. Ghost icon buttons to match the gear beside them, not the
 * heavy-shadow/white-border treatment a button floating *over a map*
 * needs to read against arbitrary tile colors underneath it -- this
 * sits on a plain panel background instead.
 *
 * A split button (shadcn's own pattern, primary action + a chevron
 * opening a `DropdownMenu`), not two equal icon buttons side by side --
 * generate and listen are two steps of one task, not two unrelated
 * actions, so the main click does whichever one is next (generate while
 * there's no narrative yet, then listen once there is), and the menu
 * behind the chevron holds both as explicit choices for whichever one
 * a pilot actually wants right now (re-hear it after already reading
 * it, say). "Back to map" used to live here too, as a third icon
 * button -- moved out into its own text button in the header's own
 * title slot instead of staying a second, redundant way to say the
 * same thing.
 *
 * The narrative's own text used to have a permanent home further down
 * the page (a "Briefing Narrative" `CollapsibleSection`) -- moved into
 * this `Popover` instead, next to the buttons that produce it, so
 * reading it back doesn't mean scrolling away from them. On screen
 * only: a closed Popover renders nothing, so `FlightBriefingView` also
 * keeps a `hidden print:block` block with the same text for a printed
 * copy, which needs it sitting in the page rather than behind a click
 * that a piece of paper can't make.
 */
export default function NavLogActions({
  onGenerateNarrative, narrativeLoading, hasNarrative, narrative, onListenClick, listening,
}: Props) {
  const primaryAction = hasNarrative ? onListenClick : onGenerateNarrative;
  const primaryLabel = narrativeLoading
    ? "Generating…"
    : hasNarrative
      ? (listening ? "Stop" : "Listen to briefing narrative")
      : "Generate briefing narrative";
  const primaryIcon = narrativeLoading
    ? <Loader2 className="size-4 animate-spin" />
    : hasNarrative
      ? (listening ? <Square className="size-4" /> : <Volume2 className="size-4" />)
      : <Sparkles className="size-4" />;

  return (
    <>
      <ButtonGroup>
        <Button
          variant="ghost" size="icon" onClick={primaryAction} disabled={narrativeLoading}
          title={primaryLabel} aria-label={primaryLabel}
          data-testid="narrative-primary-button"
        >
          {primaryIcon}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon" disabled={narrativeLoading}
              aria-label="More narrative actions" data-testid="narrative-menu-trigger"
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={onGenerateNarrative}
              disabled={narrativeLoading || hasNarrative}
              data-testid="generate-narrative-button"
            >
              <Sparkles /> {hasNarrative ? "Narrative already generated" : "Generate narrative"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onListenClick}
              disabled={narrativeLoading}
              data-testid="listen-button"
            >
              {listening ? <Square /> : <Volume2 />} {listening ? "Stop" : "Listen to narrative"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost" size="icon" disabled={!narrative}
              title="Read briefing narrative" aria-label="Read briefing narrative"
              data-testid="narrative-text-button"
            >
              <ScrollText className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-sm text-muted-foreground">
            {narrative}
          </PopoverContent>
        </Popover>
      </ButtonGroup>
      <Button
        variant="ghost" size="icon" onClick={() => window.print()}
        title="Print" aria-label="Print" data-testid="print-button"
      >
        <Printer className="size-4" />
      </Button>
    </>
  );
}
