/**
 * The planning figures in a handbook's specifications page, from the text
 * read off a photo of it (lib/readPage): the page's own lines, each a label
 * and its figure ("Service Ceiling (ft) 14,300", "SERVICE CEILING ....
 * 13,500 FT."), as Piper's and Cessna's handbooks print them. Each figure
 * comes with the line it was read from, for the pilot to check against the
 * page; one the page does not label plainly is not guessed.
 */

export type PageFigure = { value: number; words: string };
export type PageFigures = Partial<Record<
  "cruiseTasKt" | "cruisePowerPct" | "fuelBurnGph" | "usableFuelGal" | "climbTasKt" | "serviceCeilingFt",
  PageFigure
>>;

/** A statute mile an hour in knots: 1,609.344 m / 1,852 m. */
const MPH_TO_KT = 1609.344 / 1852;

/** The page's lines, a label wrapped onto the next line put back on one:
 *  a line with a bracket left open, or with no figure at its end, goes on
 *  with the next ("Cruising Speed (75% power, sea" / "level) (mph) 121"). */
function entries(text: string): string[] {
  const out: string[] = [];
  let open = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const joined = open ? `${open} ${line}` : line;
    const unclosed = (joined.match(/\(/g)?.length ?? 0) > (joined.match(/\)/g)?.length ?? 0);
    if ((unclosed || !/\d[\d,.]*\D{0,12}$/.test(joined)) && joined.length < 160) {
      open = joined;
      continue;
    }
    out.push(joined);
    open = "";
  }
  if (open) out.push(open);
  return out;
}

/** A figure as printed: "14,300", "8.4", and "14.300" where the reading
 *  took a thousands comma for a point. */
function number(s: string): number {
  const t = s.replace(/,/g, "");
  return /^\d{1,2}\.\d{3}$/.test(t) ? Number(t.replace(".", "")) : Number(t);
}

/** The line's figure: its last number outside brackets, where a label's
 *  own numbers sit inside them ("(75% power, 7000 ft, mph) 132 (135*)") or
 *  before it ("75% Power at 8000 Ft ...... 124 KNOTS"). */
function figure(line: string): number | null {
  const bare = line.replace(/\([^)]*\)/g, " ");
  const all = [...bare.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => m[0]);
  return all.length ? number(all[all.length - 1]!) : null;
}

/** Knots, from a line that says miles an hour where it does: its own
 *  units, outside brackets, first -- "122 KTS (140 MPH)" is knots, its
 *  bracketed miles an hour a second reading of the same speed -- and a
 *  unit in brackets only where none is outside them, as Piper's "Best
 *  Rate of Climb Speed (mph) 85" puts it. */
function knots(line: string, value: number): number {
  const bare = line.replace(/\([^)]*\)/g, " ");
  const KNOTS = /\bkts?\b|\bknots?\b|\bktas\b/i;
  const MPH = /\bmph\b|miles per hour|\bm\.?p\.?h\b/i;
  if (KNOTS.test(bare)) return value;
  return MPH.test(bare) || MPH.test(line) ? Math.round(value * MPH_TO_KT) : value;
}

const power = (line: string) => Number(line.match(/(\d{2,3})\s*%/)?.[1] ?? NaN);

export function figuresOfPage(text: string): PageFigures {
  const lines = entries(text);
  const found: PageFigures = {};
  const within = (n: number | null, min: number, max: number) => n != null && Number.isFinite(n) && n >= min && n <= max;

  for (const line of lines) {
    const n = figure(line);
    if (!found.serviceCeilingFt && /service\s+ceiling/i.test(line) && within(n, 1000, 30000)) {
      found.serviceCeilingFt = { value: n!, words: line };
    }
    // "Best Rate of Climb Speed (mph) 85": a speed, not the rate itself.
    if (!found.climbTasKt && /climb/i.test(line) && /speed/i.test(line) && within(n, 30, 300)) {
      found.climbTasKt = { value: knots(line, n!), words: line };
    }
    // "Usable Fuel (gal) 48" or "Total 56 GAL. usable 53 GAL."
    if (!found.usableFuelGal && /usable/i.test(line) && !/unusable/i.test(line)) {
      const after = line.match(/usable[^\d]{0,40}(\d[\d,.]*)/i);
      const v = after ? number(after[1]!) : n;
      if (within(v, 5, 500)) found.usableFuelGal = { value: v!, words: line };
    }
  }

  // Cruise: of the page's cruising speeds, the one at a stated altitude
  // (the handbook's "optimum"), at 75% power where it says, over one at
  // sea level or at a lower, training power.
  const cruises = lines
    // Not the structural cruising speed (Vno), a limit, not a cruise.
    .filter(l => /cruis/i.test(l) && !/structural|\bv\s*no\b/i.test(l) && /speed|knots|\bkts?\b|mph/i.test(l) && within(figure(l), 30, 400))
    .map(l => ({ l, score: (/\d{3,5}\s*(ft|feet)/i.test(l) && !/sea\s*level/i.test(l) ? 2 : 0) + (power(l) === 75 ? 1 : 0) }));
  const cruise = cruises.sort((a, b) => b.score - a.score)[0];
  if (cruise) {
    found.cruiseTasKt = { value: knots(cruise.l, figure(cruise.l)!), words: cruise.l };
    const pct = power(cruise.l);
    if (within(pct, 40, 100)) found.cruisePowerPct = { value: pct, words: cruise.l };
  }

  // Fuel burn: "Fuel Consumption (gal per hr 75%) 8.4", the one at the
  // cruise's power where the page gives several.
  const burns = lines.filter(l => /fuel\s+(consumption|flow|burn)|gal(lons)?\.?\s*(per|\/)\s*h(ou)?r|\bgph\b/i.test(l) && within(figure(l), 1, 100));
  const burn = burns.find(l => found.cruisePowerPct && power(l) === found.cruisePowerPct.value) ?? burns[0];
  if (burn) {
    // Two powers' burns read onto one line ("75% 8.4 gph 65% 7.0 gph"):
    // the figure after the cruise's own power, not the line's last.
    const pct = found.cruisePowerPct?.value;
    const after = pct ? burn.replace(/\([^)]*\)/g, " ").match(new RegExp(`\\b${pct}\\s*%[^\\d]{0,20}(\\d+(?:\\.\\d+)?)`)) : null;
    const v = after ? number(after[1]!) : figure(burn)!;
    if (within(v, 1, 100)) found.fuelBurnGph = { value: v, words: burn };
  }

  return found;
}
