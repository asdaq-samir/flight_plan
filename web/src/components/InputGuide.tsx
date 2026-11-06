import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { gearFor, hearing } from "../lib/audioGear";
import { TEXT } from "../lib/text";

/** One input at a time: iOS routes to the Bluetooth device that connected
 *  last ("last in wins", Apple's AVAudioSessionCategoryOptions header), so
 *  a headset paired to the phone takes the input over from the panel. */
export const ONE_AT_A_TIME = "One input at a time: a headset paired to the phone takes the input over from the panel.";

/** What the guide says of the input heard: the radio; maybe the radio,
 *  which only a ground test tells; or a voice with the way to the radio.
 *  Nothing where the catalogue can't tell (lib/audioGear), the phone's own
 *  microphone included. */
export interface Guide {
  hears: "radio" | "maybe" | "voice";
  line: string;
  /** Under a tap: for a voice the way to the radio, for a maybe how to
   *  test it -- the gear's own steps, on the ground first, then the
   *  one-input note where they don't already say it. */
  steps: string[];
  /** The tap's words. */
  how: string | null;
}

const withNote = (steps: readonly string[]) =>
  steps.some(step => /last one to connect|takes the input/i.test(step)) ? [...steps] : [...steps, ONE_AT_A_TIME];

export function guideFor(label: string | null | undefined): Guide | null {
  const hears = hearing(label);
  if (hears === "radio") return { hears, line: "Hears the radio", steps: [], how: null };
  const gear = gearFor(label);
  if (hears === "voice") return { hears, line: "Hears your voice, not the radio", steps: withNote(gear?.steps ?? []), how: "How to hear the radio" };
  // Documented only to a camera or the maker's own app, or not at all
  // (lib/audioGear's "radio-maybe"): never said to hear the radio.
  if (gear?.gives === "radio-maybe") return { hears: "maybe", line: "May hear the radio: test it on the ground", steps: withNote(gear.steps), how: "How to test it" };
  return null;
}

/**
 * Under the Hearing line of Listen through (ListenThrough): what the live
 * input brings, from the audio gear catalogue (lib/audioGear) by its
 * label -- the owner's look and go (2026-11-03): one line at a glance,
 * the steps folded under a tap. The radio: "Hears the radio". A voice --
 * a headset's boom mic, a panel's phone mode -- "Hears your voice, not
 * the radio", and "How to hear the radio" opening its maker's steps.
 * Gear only a ground test can tell: "May hear the radio: test it on the
 * ground", and "How to test it". Nothing for what it can't name.
 */
export default function InputGuide({ label }: { label: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const guide = guideFor(label);
  if (!guide) return null;
  if (!guide.how) {
    return <p className={cn("font-semibold text-go-ink", TEXT.detail)} data-testid="input-guide" data-hears={guide.hears}>{guide.line}</p>;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("flex flex-col gap-1", TEXT.detail)} data-testid="input-guide" data-hears={guide.hears}>
      <p className="font-semibold text-caution-ink">{guide.line}</p>
      {/* Its 44-point area a pseudo-element round the words. */}
      <CollapsibleTrigger
        data-testid="input-guide-how"
        className="relative flex items-center gap-1 self-start rounded-sm text-tint outline-none after:absolute after:-inset-x-2 after:-inset-y-[11px] after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
      >
        {guide.how}
        <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <ol className={cn("list-decimal pl-5 text-foreground/80", TEXT.note)} data-testid="input-guide-steps">
          {guide.steps.map(step => <li key={step}>{step}</li>)}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
