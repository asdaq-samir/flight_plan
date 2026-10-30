import { memo } from "react";
import { cn } from "cn";
import type { PillHead } from "../lib/openCards";

/** The round buttons on the pill over a card's picture: a light pane of
 *  glass with the glyph white, which reads on the shade below whatever
 *  the picture, as the head's dark ones do on the picture itself. */
export const ON_PILL_PICTURE = "bg-white/20 text-white backdrop-blur-md hover:bg-white/30 hover:text-white dark:bg-white/20 dark:hover:bg-white/30";

/**
 * Behind the pill while an airport's or an airplane's card is in it, at
 * the owner's pick (P5, 2026-10-29): the card's head's first picture,
 * blurred and darkened, so the pill reads as the head drawn small, as
 * Maps' place does down at its smallest. Under the pill's own words and
 * buttons (the panel's stacking context, -z-10), clipped to its round
 * shape by the panel's own clip.
 *
 * The shade is what keeps the words legible on any picture: at its
 * lightest, the right end's 55% black over a white picture, the ground
 * is #737373 (relative luminance 0.17), against which white is 4.7:1, past
 * the 4.5:1 WCAG 2 asks of words; darker under the name. The buttons'
 * white glass over it there, #8f8f8f, keeps a white glyph at 3.2:1, past
 * the 3:1 for a control's glyph. With no picture to load, the head's dark
 * slate, or the tint it draws for an airplane with no photo.
 */
export const PillPicture = memo(function PillPicture({ pill }: { pill: PillHead }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", pill.tint && !pill.picture ? "bg-primary" : "bg-zinc-800")} data-testid="pill-picture">
      {pill.picture && (
        // Larger than the pill, so the blur's soft edge is out of sight.
        <img src={pill.picture} alt="" decoding="async" className="absolute inset-0 size-full scale-125 object-cover blur-xl" data-testid="pill-picture-img" />
      )}
      <div className="absolute inset-0 bg-linear-to-r from-black/70 to-black/55" />
    </div>
  );
});
