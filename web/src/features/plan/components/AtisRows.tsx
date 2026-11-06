import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { RowBadge } from "../../../components/RowBadge";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { canListen } from "../../../lib/listen";
import { chosenOutside, heardThrough, lostWords, useAtcRadio } from "../../../lib/atcRadio";
import { atisRows, glanceWords, heardAny, hearAtis, readAtis, type AtisReading } from "../../../lib/atis";

/**
 * Listen to ATIS, on the field card's Weather tab under the report: a
 * tap hears one broadcast through the microphone (lib/atis's hearAtis,
 * the same recognizer as the radio's), the engine reads it, and what
 * matters at the hold-short line is one line -- the runway in use and
 * the altimeter -- with the figures in a short table under it and the
 * transcript folded away. A failure is said in the row, not a toast
 * (lib/problems). Only where the phone or browser can listen at all.
 *
 * It hears through the input the radio does (lib/audioInput): where the
 * recognizer is known to hear an audio panel's Bluetooth link or a cable
 * chosen (lib/atcRadio's heardThrough), the row says so and no longer asks
 * for the phone at the speaker (the owner's "Bluetooth is fine",
 * 2026-11-04). Why it did not listen, or stopped for the microphone, is a
 * notice in caution ink, not a failure.
 */
export function AtisRows() {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [reading, setReading] = useState<AtisReading | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const input = useAtcRadio(s => s.input);
  const through = heardThrough(input);
  const chosen = chosenOutside(input);
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
    setNotice(null);
    setReading(null);
    setHeard("");
    const hearing = hearAtis(setHeard);
    stop.current = hearing.stop;
    void hearing.done.then(({ text, error, notice: why, through: heardThrough }) => {
      stop.current = null;
      setListening(false);
      if (error) {
        setProblem(error);
        return;
      }
      if (!text && why) {
        setNotice(why);
        return;
      }
      if (!text) {
        // In words for a cable or a panel alike: the page cannot tell them apart.
        setProblem(heardThrough
          ? `Nothing was heard through ${heardThrough}. Tune the ATIS, check it is sending the radio (an audio panel's recording mode, or the cable) and tap again.`
          : "Nothing was heard. Tune the ATIS, hold the phone to the speaker and tap again.");
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
  const lost = listening && input?.lost ? lostWords(input) : null;
  const caution = notice ?? lost;
  return (
    <div className="pt-5" data-testid="place-atis">
      <ListGroup>
        <ListRow
          media={<RowBadge colour={BADGE.weather}><Radio /></RowBadge>}
          title={listening ? "Listening…" : "Listen to ATIS"}
          description={listening
            ? heard || (through ? `Tune the ATIS or AWOS; listening through ${through}`
              : chosen ? `Tune the ATIS or AWOS; ${chosen} chosen, or hold the phone to the speaker`
                : "Tune the ATIS or AWOS and hold the phone to the speaker")
            : undefined}
          onClick={start} data-testid="place-atis-listen"
        />
        {(problem || caution) && <ListRow muted title={<span className={cn(problem ? "text-destructive" : "text-caution-ink", TEXT.detail)} data-testid="place-atis-problem">{problem ?? caution}</span>} />}
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
