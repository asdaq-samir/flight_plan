import { useEffect } from "react";
import { cn } from "cn";
import PullDown from "./PullDown";
import Waveform from "./Waveform";
import { useAtcRadio } from "../lib/atcRadio";
import { canPickInput, find, hold, matchInput, pick, refresh, useInputs } from "../lib/audioInput";
import { canListen } from "../lib/listen";
import { usePreferences } from "../lib/preferences";
import { TEXT } from "../lib/text";

/**
 * Listen through: the input the radio is heard through, in the Radio
 * card's Hear detail, where listening to the radio is started -- an audio
 * panel's or a headset's Bluetooth link, a cable, or the phone's own
 * microphone (the owner, 2026-11-04: "can the mic button tune into a
 * frequency?", then "Bluetooth is fine"). A control added inside a row the
 * card has, none moved. Chosen before Listen, the capture opens first and
 * the recognizer second, the order most likely to carry the route to it,
 * and the Hearing line's bars show the radio arriving before it is
 * relied on.
 *
 * Before this page load's first capture Safari names no inputs, so Find
 * Inputs stands in the menu's place: its tap is the grant. Shown only
 * where an input can be picked (lib/audioInput's canPickInput): not in
 * the apps, not on Chrome for Android.
 */
export default function ListenThrough() {
  const found = useInputs(s => s.found);
  const inputs = useInputs(s => s.inputs);
  const chosen = useInputs(s => s.chosen);
  const input = useAtcRadio(s => s.input);
  const kept = usePreferences(s => s.listenInput);
  const shown = canListen() && canPickInput();
  // The card's hold: what it opens stays open while the card is, and is
  // let go with it unless the radio is still being listened to.
  useEffect(() => {
    if (!shown) return;
    const release = hold();
    void refresh();
    return release;
  }, [shown]);
  if (!shown) return null;
  const value = chosen ?? matchInput(inputs, kept)?.id ?? "";
  return (
    <div className="flex flex-col gap-2" data-testid="listen-through">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-muted-foreground">Listen through</span>
        {found ? (
          <PullDown
            label="Listen through" value={value} align="start" placeholder="Choose" testId="listen-input"
            options={inputs.map(i => ({ value: i.id, label: i.label, testId: "listen-input-option" }))}
            onChange={id => void pick(id)}
          />
        ) : (
          // Its 44-point area a pseudo-element round the words, as the
          // pull-down's that takes its place.
          <button
            type="button" onClick={() => void find()} data-testid="listen-find"
            className={cn(
              "relative rounded-sm text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "after:absolute after:-inset-x-2 after:-inset-y-[11px] after:content-['']", TEXT.row,
            )}
          >
            Find Inputs
          </button>
        )}
      </div>
      {/* What is live, with its level; the input chosen gone, what is
          heard instead in caution ink, the card's error line saying why. */}
      {input && (
        <div className="flex items-center gap-3" data-testid="listen-hearing">
          <span className="w-24 shrink-0 text-muted-foreground">Hearing</span>
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            {!input.lost && <Waveform live />}
            <span className={cn("truncate", input.lost && "text-caution-ink")}>{input.lost ? input.instead || "Default microphone" : input.label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
