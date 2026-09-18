import { Loader2, Printer, Sparkles, Square, Volume2 } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { ButtonGroup } from "../../../../components/ui/button-group";

interface Props {
  /** Generates the narrative -- disabled once one already exists,
   *  since generating again would be a second real, billed Claude call
   *  for text already sitting right there. The Briefing Narrative
   *  section further down the page used to have its own separate
   *  "Generate narrative" button that did exactly this same thing --
   *  removed once this one existed, rather than two controls a pilot
   *  has to notice are the same control. */
  onGenerateNarrative: () => void;
  narrativeLoading: boolean;
  hasNarrative: boolean;
  /** Plays the narrative if one exists; generates it first (then
   *  plays) if a pilot reaches for this before ever clicking Generate
   *  -- toggles to stop once actually playing. Shares its `speaking`
   *  state with the Briefing Narrative section's own Listen button
   *  (see `usePlanState`'s own `speak`/`stopSpeaking`) rather than each
   *  owning an independent one, so the two can't disagree about
   *  whether a voice is playing. */
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
 * Generate and Listen are a `ButtonGroup` (shadcn's own split-button
 * primitive, visually one joined control), not two separate icon
 * buttons scattered across the row -- they're two steps of one task
 * (write it, then hear it), not two unrelated actions, and grouping
 * them says so at a glance. Not a dropdown *menu* -- there's nothing
 * to choose between, just the two fixed steps, always both visible.
 * "Back to map" used to live here too, as a third icon button -- moved
 * out into its own text button in the header's own title slot instead
 * of staying a second, redundant way to say the same thing.
 */
export default function NavLogActions({
  onGenerateNarrative, narrativeLoading, hasNarrative, onListenClick, listening,
}: Props) {
  return (
    <>
      <ButtonGroup>
        <Button
          variant="ghost" size="icon" onClick={onGenerateNarrative}
          disabled={narrativeLoading || hasNarrative}
          title={hasNarrative ? "Narrative already generated" : "Generate briefing narrative"}
          aria-label={hasNarrative ? "Narrative already generated" : "Generate briefing narrative"}
          data-testid="generate-narrative-button"
        >
          {narrativeLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        </Button>
        <Button
          variant="ghost" size="icon" onClick={onListenClick} disabled={narrativeLoading}
          title={listening ? "Stop" : "Listen to briefing narrative"}
          aria-label={listening ? "Stop" : "Listen to briefing narrative"}
          data-testid="listen-button"
        >
          {listening ? <Square className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
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
