import { useEffect, useState } from "react";
import { cn } from "cn";
import PullDown from "./PullDown";
import Waveform from "./Waveform";
import InputGuide from "./InputGuide";
import { FieldError } from "./ui/field";
import { inputLevel, lostWords, useAtcRadio } from "../lib/atcRadio";
import { canPickInput, find, hold, isOutside, matchInput, pick, refresh, useInputs } from "../lib/audioInput";
import { canListen } from "../lib/listen";
import { usePreferences } from "../lib/preferences";
import { TEXT } from "../lib/text";

/** The level's highest over a while that counts as sound arriving: -45
 *  dBFS on lib/audioInput's 0 to 1 (-60 to 0 dBFS), above a quiet line. */
const SOUND = 0.25;
/** How often the word for it may change, ms: a screen reader is told a
 *  state, not a meter ten times a second. */
const SOUND_EVERY_MS = 3000;

/** Whether sound is arriving, for VoiceOver, where the bars are hidden
 *  from it: the level's highest over each three seconds, as a word. */
function useSoundArriving(on: boolean): boolean | null {
  const [arriving, setArriving] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on) return;
    let peak = 0;
    const off = inputLevel.listen(level => { if (level !== null) peak = Math.max(peak, level); });
    const every = setInterval(() => {
      setArriving(peak > SOUND);
      peak = 0;
    }, SOUND_EVERY_MS);
    return () => {
      off();
      clearInterval(every);
    };
  }, [on]);
  return on ? arriving : null;
}

/**
 * Listen through: the input the radio is heard through, in the Radio
 * card's Hear detail, where listening to the radio is started -- an audio
 * panel's or a headset's Bluetooth link, a cable, or the phone's own
 * microphone (the owner, 2026-11-04: "can the mic button tune into a
 * frequency?", then "Bluetooth is fine"). A control added inside a row the
 * card has, none moved. Chosen before Listen, the capture opens first and
 * the recognizer second, the order most likely to carry the route to it,
 * and the line under it shows the sound arriving before it is relied on.
 *
 * Before this page load's first capture Safari names no inputs, so a
 * button stands in the menu's place -- the input remembered by its name,
 * which the next listening will open, or Find Inputs -- and its tap is the
 * grant. Why an input could not be had, or that the one chosen is no
 * longer heard, is said under it, where it was chosen (lib/problems: an
 * error where it happens). Shown only where an input can be picked (lib/
 * audioInput's canPickInput): not in the apps, not on Chrome for Android.
 */
export default function ListenThrough() {
  const found = useInputs(s => s.found);
  const inputs = useInputs(s => s.inputs);
  const chosen = useInputs(s => s.chosen);
  const problem = useInputs(s => s.problem);
  const input = useAtcRadio(s => s.input);
  // A recognizer is listening -- the radio, the microphone or the ATIS --
  // so the input is heard, not only held.
  const hearing = useAtcRadio(s => s.listening || !!s.atisStop);
  const kept = usePreferences(s => s.listenInput);
  const shown = canListen() && canPickInput();
  const arriving = useSoundArriving(shown && !!input && !input.lost && !input.paused);
  // The card's hold: what it opens stays open while the card is, and is
  // let go with it unless the radio is still being listened to.
  useEffect(() => {
    if (!shown) return;
    const release = hold();
    void refresh();
    return release;
  }, [shown]);
  if (!shown) return null;
  // While the input chosen is not heard, none is shown as chosen, so it
  // can be chosen again.
  const value = input?.lost ? "" : chosen ?? matchInput(inputs, kept)?.id ?? "";
  const remembered = kept && isOutside(kept.label) ? kept.label : null;
  const lost = input?.lost ? lostWords(input) : null;
  // What the input chosen brings (InputGuide, lib/audioGear): the one
  // heard, or before listening the one picked or remembered -- not one
  // lost, whose words say what is heard instead.
  const guideLabel = input
    ? (input.lost ? null : input.label)
    : inputs.find(i => i.id === value)?.label ?? remembered;
  return (
    // Twelve points over the first line and four under it, so its controls'
    // 44-point areas (index.css's pseudo-element, eleven or twelve over and
    // under their words) meet the Hear row and the field rather than lie
    // over them. The names in a column as wide as the widest: "Listen
    // through" is 103 points in Inter at the detail's 15 (measured in
    // Chromium, 2026-11-04), over the card's 96-point name column, and
    // broke onto two lines there.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pt-3 pb-1" data-testid="listen-through">
      <span className="whitespace-nowrap text-muted-foreground">Listen through</span>
      <div className="flex min-w-0">
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
              "relative inline-flex min-w-0 rounded-sm text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "after:absolute after:-inset-x-2 after:-inset-y-[11px] after:content-['']", TEXT.row,
            )}
          >
            {/* Cut short inside, not the button itself, which would clip
                its area. */}
            <span className="truncate">{remembered ?? "Find Inputs"}</span>
          </button>
        )}
      </div>
      {/* What the input brings, with its level: "Hearing" while a
          recognizer listens, "Sound from" while it is only held; the input
          chosen gone, what is heard instead in caution ink. */}
      {input && (
        <div className="contents" data-testid="listen-hearing">
          <span className="whitespace-nowrap text-muted-foreground">{hearing ? "Hearing" : "Sound from"}</span>
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            {!input.lost && !input.paused && <Waveform live />}
            <span className={cn("truncate", input.lost && "text-caution-ink", input.paused && "font-normal text-muted-foreground")}>
              {input.lost ? input.instead || "Default microphone" : input.paused ? `${input.label} paused` : input.label}
            </span>
            {arriving !== null && <span className="sr-only">{arriving ? "Sound arriving" : "Quiet"}</span>}
          </span>
        </div>
      )}
      {/* Under the input's name, in its column: whether it brings the
          radio, a voice, or only a ground test can tell, the steps folded
          under a tap (the owner's look and go). */}
      {guideLabel && (
        <div className="col-start-2 min-w-0">
          <InputGuide label={guideLabel} />
        </div>
      )}
      {problem
        ? <FieldError className="col-span-2" data-testid="listen-problem">{problem}</FieldError>
        : lost && <p className="col-span-2 text-caution-ink" data-testid="listen-problem">{lost}</p>}
    </div>
  );
}
