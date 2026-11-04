import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { RowBadge } from "../../../components/RowBadge";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { canListen } from "../../../lib/listen";
import { atisRows, glanceWords, heardAny, hearAtis, readAtis, type AtisReading } from "../../../lib/atis";

/**
 * Listen to ATIS, on the field card's Weather tab under the report: a
 * tap hears one broadcast through the microphone (lib/atis's hearAtis,
 * the same recognizer as the radio's), the engine reads it, and what
 * matters at the hold-short line is one line -- the runway in use and
 * the altimeter -- with the figures in a short table under it and the
 * transcript folded away. A failure is said in the row, not a toast
 * (lib/problems). Only where the phone or browser can listen at all.
 */
export function AtisRows() {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [reading, setReading] = useState<AtisReading | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  // Keyed by the field in PlaceCard, so another field's card is another
  // broadcast; the hearing ends with the card.
  useEffect(() => () => stop.current?.(), []);
  if (!canListen()) return null;

  const start = () => {
    if (listening) {
      stop.current?.();
      return;
    }
    setListening(true);
    setProblem(null);
    setReading(null);
    setHeard("");
    const hearing = hearAtis(setHeard);
    stop.current = hearing.stop;
    void hearing.done.then(({ text, error }) => {
      stop.current = null;
      setListening(false);
      if (error) {
        setProblem(error);
        return;
      }
      if (!text) {
        setProblem("Nothing was heard. Tune the ATIS, hold the phone to the speaker and tap again.");
        return;
      }
      try {
        const read = readAtis(text);
        setReading(read);
        if (!heardAny(read)) setProblem("Nothing of a broadcast was heard in that.");
      } catch (err) {
        setProblem(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const glance = reading && heardAny(reading) ? glanceWords(reading) : null;
  return (
    <div className="pt-5" data-testid="place-atis">
      <ListGroup>
        <ListRow
          media={<RowBadge colour={BADGE.weather}><Radio /></RowBadge>}
          title={listening ? "Listening…" : "Listen to ATIS"}
          description={listening ? heard || "Tune the ATIS or AWOS and hold the phone to the speaker" : undefined}
          onClick={start} data-testid="place-atis-listen"
        />
        {problem && <ListRow muted title={<span className={cn("text-destructive", TEXT.detail)} data-testid="place-atis-problem">{problem}</span>} />}
        {glance && (
          <ListRow
            title={<span className="font-semibold text-foreground">{glance}</span>} data-testid="place-atis-glance"
            value={reading?.information ? <span className="text-foreground">Information {reading.information}</span> : undefined}
          />
        )}
        {reading && heardAny(reading) && atisRows(reading).map((row, k) => (
          <ListRow key={`${row.label}-${k}`} title={row.label} value={<span className="text-foreground">{row.value}</span>} data-testid="place-atis-row" />
        ))}
        {reading && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <ListRow title="Transcript" chevron data-testid="place-atis-transcript" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ListRow title={<span className={cn("font-mono break-words text-muted-foreground", TEXT.detail)} data-testid="place-atis-raw">{reading.raw}</span>} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </ListGroup>
    </div>
  );
}
