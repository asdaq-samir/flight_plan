import { Loader2, Map, Printer, Square, Volume2 } from "lucide-react";
import { Button } from "../../../../components/ui/button";

interface Props {
  onMapClick: () => void;
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
 * The nav log's own actions -- back to the map, listen to the briefing
 * narrative, print this -- rendered inline in the briefing view's own
 * header row (alongside its "Flight Briefing" label and the Settings
 * gear), not floating over the content the way this component used to.
 * Plain ghost icon buttons to match the gear beside them, not the
 * heavy-shadow/white-border treatment a button floating *over a map*
 * needs to read against arbitrary tile colors underneath it -- this
 * sits on a plain header background instead.
 */
export default function NavLogActions({ onMapClick, onListenClick, listenLoading, listening }: Props) {
  return (
    <>
      <Button
        variant="ghost" size="icon" onClick={onMapClick}
        title="Back to map" aria-label="Back to map" data-testid="nav-back-to-map-button"
      >
        <Map className="size-4" />
      </Button>
      <Button
        variant="ghost" size="icon" onClick={onListenClick} disabled={listenLoading}
        title={listening ? "Stop" : "Listen to briefing narrative"}
        aria-label={listening ? "Stop" : "Listen to briefing narrative"}
        data-testid="listen-button"
      >
        {listenLoading
          ? <Loader2 className="size-4 animate-spin" />
          : listening ? <Square className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
      <Button
        variant="ghost" size="icon" onClick={() => window.print()}
        title="Print" aria-label="Print" data-testid="print-button"
      >
        <Printer className="size-4" />
      </Button>
    </>
  );
}
