import { useEffect, useState } from "react";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import TickBox from "../../../../components/TickBox";
import { inNativeApp, nativeShareText } from "../../../../lib/native";
import { PASSENGER_ITEMS } from "../../../../lib/passengers";
import { usePreflight, useTicked } from "../../../../lib/preflight";
import { showError } from "../../../../lib/problems";

/**
 * The Brief's Passengers: the briefing 14 CFR 91.107 asks of the pilot in
 * command before every takeoff, and good practice besides, ticked off for
 * this flight as the preflight action is (lib/preflight's ticks, its own
 * keys); then the flight in a few lines, sent to the passengers from the
 * share sheet (lib/passengers).
 */
export default function PassengerBriefing({ flight, message }: { flight: string; message: string }) {
  const ticked = useTicked(flight);
  const tick = usePreflight(s => s.tick);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const done = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(done);
  }, [copied]);
  const send = async () => {
    try {
      if (inNativeApp()) await nativeShareText("Our flight", message);
      else if (navigator.share) await navigator.share({ title: "Our flight", text: message });
      else {
        await navigator.clipboard.writeText(message);
        setCopied(true);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") showError("Could not send the flight", (err as Error).message);
    }
  };
  const done = PASSENGER_ITEMS.filter(i => ticked[i.key]).length;
  return (
    <AccordionSection title="Passengers">
      <div className="space-y-4" data-testid="passengers">
        <ListGroup
          title={`Brief them · ${done} of ${PASSENGER_ITEMS.length}`}
          footer="91.107 asks the first two of the pilot in command before every takeoff; the rest is good practice."
        >
          {PASSENGER_ITEMS.map(item => (
            <ListRow
              key={item.key} role="checkbox" aria-checked={!!ticked[item.key]}
              onClick={() => tick(flight, item.key, !ticked[item.key])}
              media={<TickBox on={!!ticked[item.key]} />}
              title={item.title} description={item.rule}
              data-testid={`passenger-${item.key}`}
            />
          ))}
        </ListGroup>
        <ListGroup footer={message.split("\n").join(" ")}>
          <ListRow title={copied ? "Copied" : "Send the flight to your passengers"} onClick={() => void send()} data-testid="passenger-send" />
        </ListGroup>
      </div>
    </AccordionSection>
  );
}
