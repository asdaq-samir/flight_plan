import { Loader2, Printer, Square, Volume2 } from "lucide-react";
import { Button } from "../../../../components/ui/button";

interface Props {
  /** Generates the narrative if none exists yet, then reads it aloud
   *  the moment it's ready; toggles playback if one's already
   *  generated. Shares its `speaking` state with the Briefing Narrative
   *  section further down the page (see `usePlanState`'s own `speak`/
   *  `stopSpeaking`) rather than each owning an independent one, so the
   *  two controls can't disagree about whether a voice is playing. */
  onListenClick: () => void;
  listenLoading: boolean;
  listening: boolean;
}

/**
 * The nav log's own top-right row -- listen to the briefing narrative,
 * or print this. No "back to map" button here any more -- the site
 * header's own "Plan" link is that, now that this view is a real URL
 * state (`?view=briefing`, see PlanView) rather than a page-local
 * toggle a dedicated button was the only way back from. Icon-only, not
 * the text pill `MapActionButton` uses elsewhere: side by side they
 * read more like a toolbar than competing actions once they both say
 * something in words. `print:hidden` throughout (see `NavLogView`'s
 * own print overrides) -- neither belongs in the printed page itself.
 */
const buttonClass = "size-10 rounded-lg border-2 border-background shadow-[0_2px_10px_rgba(0,0,0,.5)] print:hidden";

export default function NavLogActions({ onListenClick, listenLoading, listening }: Props) {
  return (
    <div className="absolute right-3 top-3 z-[1000] flex gap-2 print:hidden">
      <Button
        onClick={onListenClick} disabled={listenLoading}
        title={listening ? "Stop" : "Listen to briefing narrative"}
        aria-label={listening ? "Stop" : "Listen to briefing narrative"}
        data-testid="listen-button" className={buttonClass}
      >
        {listenLoading
          ? <Loader2 className="size-5 animate-spin" />
          : listening ? <Square className="size-5" /> : <Volume2 className="size-5" />}
      </Button>
      <Button
        onClick={() => window.print()} title="Print" aria-label="Print"
        data-testid="print-button" className={buttonClass}
      >
        <Printer className="size-5" />
      </Button>
    </div>
  );
}
