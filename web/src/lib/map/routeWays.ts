import { divIcon, made } from "./icons";
import { text } from "./airportMark";

/** A way FPL's route line offers beside the route (its chips), as the map
 *  draws it: its line and the words on its chip. */
export interface RouteWay {
  key: string;
  path: [number, number][];
  /** Its time, "3 h 40 min". */
  label: string;
  /** Its name, said on its callout while it is the one shown, "Best Weather". */
  name?: string;
  /** Where along it its chip sits, a share of its length: given by the
   *  caller so it holds as the other ways come and go (else by place). */
  share?: number;
}

/** Where along each way its chip sits, a share of its length, one apiece. */
export const WAY_SHARES = [0.35, 0.6, 0.8];
/** The chip's fill: the line's magenta a step darker, white words at 13
 *  points on it 6:1 (WCAG 1.4.3 asks 4.5; the line's own #e600e6 is 3.8). */
const WAY_CHIP = "#b000b0";

/** The chip on a way's line: its names and time, as Maps marks the
 *  routes beside the one picked, in the line's magenta; 24 tall, its
 *  44-point hit area a pseudo-element round it. */
export const wayIcon = made(function wayIcon(key: string, label: string, name: string, shown: boolean) {
  // A callout as Maps puts on its routes: the one shown filled in
  // magenta with its name under its time, the others white with the time in
  // magenta; a tail down to the line. Sized to its words, so the marker
  // has a box (a hit test, a test's "visible").
  const lines = shown && name ? 2 : 1;
  const width = Math.ceil(Math.max(label.length, shown ? name.length : 0) * 7.6) + 22;
  const height = lines === 2 ? 40 : 24;
  const fill = shown ? WAY_CHIP : "#ffffff";
  const ink = shown ? "#ffffff" : WAY_CHIP;
  return divIcon({
    className: "",
    iconSize: [width, height], iconAnchor: [14, height + 7],
    html: `<span data-route-way="${text(key)}" class="relative flex h-full w-full flex-col justify-center rounded-xl px-2.5 text-[13px] leading-4 font-semibold shadow-[0_1px_4px_rgba(0,0,0,.35)] after:absolute after:-inset-x-1 after:-inset-y-1 after:content-['']" style="background-color:${fill};color:${ink}">` +
      `<span class="whitespace-nowrap tabular-nums">${text(label)}</span>` +
      (lines === 2 ? `<span class="whitespace-nowrap font-medium">${text(name)}</span>` : "") +
      `<span aria-hidden="true" class="absolute left-2 top-full h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent" style="border-top-color:${fill}"></span></span>`,
  });
});

/** Where a way's chip sits: `share` of the way along it. */
export function wayAt(path: [number, number][], share: number): [number, number] {
  const legs = path.slice(1).map((b, i) => {
    const a = path[i]!;
    return Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180));
  });
  let left = legs.reduce((sum, d) => sum + d, 0) * share;
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i]! || i === legs.length - 1) {
      const a = path[i]!, b = path[i + 1]!, t = legs[i] ? Math.min(1, left / legs[i]!) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= legs[i]!;
  }
  return path[0]!;
}

