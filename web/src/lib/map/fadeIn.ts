/** How long a mark drawn for the first time takes to come in, ms: half
 *  the fifth of a second it was, which every new mark on the map spent
 *  coming in behind the chart after each pan and zoom (the map's load
 *  audit, 2026-11-04: after a zoom from 7 to 9 the VORs were whole 0.95 s
 *  after the map stopped and the altitudes 1.09 s, the rings, which have
 *  no fade, 0.75 s). Still a fade, not a cut, so a zoom that brings in a
 *  few dozen at once does not have them all appear in one frame. */
export const FADE_MS = 100;

/** The most marks one memory keeps as drawn: a few flights' worth. */
const MOST_KEPT = 5000;

/**
 * Which of a canvas's marks have been drawn before in the session, and how
 * far one drawn for the first time has come in: the airports' marks, the
 * VORs and fixes, the VFR waypoints and the airspace's altitudes. A mark
 * new to the session fades in over FADE_MS from its first drawing, as
 * Maps brings its labels in, where a zoom that brought in a few dozen had
 * them all appear in one frame (the owner's audit, 2026-11-02: "very
 * dynamic while zooming in"). One drawn before is drawn at once however it
 * went away -- a pan off it, a zoom out past its level, a new box's answer
 * with the same mark in it -- so ground already seen comes back whole and
 * nothing on it fades in again (the owner, 2026-11-04: "make it fast but
 * stable"). Kept by the mark's key, not its object, which each answer
 * makes anew; and by the module that draws the marks, not the layer, which
 * is made again each time the map zooms back in past its level. Under
 * Reduce Motion none fades.
 *
 * Bounded in two halves: as the newer fills, the older is forgotten and
 * the newer takes its place, and a mark found in the older is moved back
 * into the newer as it is drawn. What is forgotten is what has not been
 * drawn for longest, never what is on the screen; the altitudes' memory,
 * emptied all at once, faded in every label on the screen again at once.
 */
export class FadeIn {
  private newer = new Set<string>();
  private older = new Set<string>();
  /** When each mark drawn for the first time was, while it may be fading. */
  private readonly born = new Map<string, number>();

  constructor(private readonly most = MOST_KEPT) {}

  /** Whether `key` has been drawn before (and is still remembered). */
  drawn(key: string): boolean {
    return this.newer.has(key) || this.older.has(key);
  }

  /** The opacity to draw `key` at, at `now` (ms), as it is drawn, and it
   *  remembered as drawn: from 0 at its first drawing to 1 FADE_MS later,
   *  then 1; 1 at once for a mark drawn before, or under Reduce Motion
   *  (`still`). A canvas draws again at the next frame while any mark it
   *  drew is below 1, and no more once every one is at 1. */
  alpha(key: string, now: number, still: boolean): number {
    if (!this.remember(key, now)) {
      if (still) return 1;
      this.born.set(key, now);
      return 0;
    }
    const born = this.born.get(key);
    if (born === undefined) return 1;
    const alpha = (now - born) / FADE_MS;
    if (alpha < 1) return Math.max(0, alpha);
    this.born.delete(key);
    return 1;
  }

  /** `key` kept among the newer; whether it had been drawn before. */
  private remember(key: string, now: number): boolean {
    if (this.newer.has(key)) return true;
    const known = this.older.delete(key);
    if (this.newer.size >= this.most / 2) {
      this.older = this.newer;
      this.newer = new Set();
      // The fades long over, of marks gone from the screen before they
      // ended, let go with the forgotten half.
      for (const [was, at] of this.born) if (now - at >= FADE_MS) this.born.delete(was);
    }
    this.newer.add(key);
    return known;
  }
}
