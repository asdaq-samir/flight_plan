/**
 * How good a checkpoint is, as a colour: one ochre hue, pale to dark,
 * more ink for a better landmark. The planner's scores and the training
 * workspace's ratings are the same scale, so each step is one colour in
 * both views.
 *
 * Not green-to-red. The route map draws its airports in the FAA's
 * flight-category colours, and the old scale's best and worst steps
 * were VFR green and IFR red to the hex -- so "red" meant both
 * "instrument conditions at the field" and "a weak landmark" on one
 * screen. Ochre is no flight category's hue. The steps were checked as
 * an ordinal ramp (one hue, even lightness steps, the palest still 2.4:1
 * against the markers' white casing) and are at least 13.8 OKLab units
 * from every flight-category colour.
 */
export const SCORE_STEPS = ["#d99a1e", "#b98014", "#96660e", "#724d09", "#4e3406"] as const;

/** Text or a number drawn on a step: white where it reads, ink where
 *  the step is too pale for white (the two palest). */
export function inkOn(fill: string): string {
  const linear = (i: number) => {
    const c = parseInt(fill.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  // Contrast against white is (1.05) / (L + 0.05); below 4.5:1, ink.
  return 1.05 / (luminance + 0.05) >= 4.5 ? "#ffffff" : "#1c1a17";
}
