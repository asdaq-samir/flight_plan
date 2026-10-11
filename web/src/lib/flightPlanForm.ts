import type { Leg, Totals } from "./api/types";

/**
 * The FAA's flight plan form filled in from a plan: FAA Form 7233-4, the
 * International Flight Plan, which a domestic IFR flight files and every
 * civil VFR flight plan is filed on (AIM 5-1-5, 5-1-6), each item written
 * as AIM Appendix 4 has it. A route that lands on the way is one form a
 * flight, as AIM 5-1-5 recommends for a stopover and an IFR flight plan
 * is filed, airport to airport.
 *
 * Only what the plan knows: the airplane's equipment (item 10), and the
 * persons on board, its colour and the pilot's name and number (item 19)
 * are the filing service's aircraft and pilot profiles'.
 */

export interface FormItem {
  /** The form's item: "7", "15". */
  item: string;
  key: string;
  label: string;
  /** As it is written on the form; null where the plan cannot say. */
  value: string | null;
  note?: string;
}

export interface FlightPlanForm {
  departure: string;
  destination: string;
  items: FormItem[];
}

export interface FormInput {
  rules: "vfr" | "ifr";
  dep: string;
  dest: string;
  /** The stops as typed, airways among them, in order. */
  route: string[];
  /** Those of the stops landed at. */
  landings: string[];
  /** Whether a stop is an airway (V191) rather than a place. */
  isAirway: (stop: string) => boolean;
  legs: Leg[];
  totals: Totals | null;
  /** The departure picked; null where none was. */
  depart: Date | null;
  now: Date;
  aircraft: { ident: string | null; type: string | null; maxTakeoffLb: number | null };
  /** The fuel aboard at the first departure, where Weight & Balance says
   *  it; the tanks' usable fuel otherwise, and at every stop. */
  fuelGal: number | null;
  /** Under IFR, the alternate filed, for the last flight. */
  alternate: string | null;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Item 15's cruising speed: the true airspeed in knots, N and four
 *  figures (AIM Appendix 4: "N0450"). */
export function cruisingSpeed(tasKt: number): string {
  return `N${pad(Math.round(tasKt), 4)}`;
}

/** Item 15's level: a flight level, F and three figures, at and above
 *  18,000 ft, where the altimeter is set to 29.92 (14 CFR 91.121(a)(2));
 *  below it the altitude in hundreds of feet, A and three figures (AIM
 *  Appendix 4: "F350", "A080"). */
export function cruisingLevel(altitudeFt: number): string {
  return `${altitudeFt >= 18_000 ? "F" : "A"}${pad(Math.round(altitudeFt / 100), 3)}`;
}

/** Hours and minutes in four figures, HHMM (items 16 and 19). */
export function hoursMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60), 2)}${pad(minutes % 60, 2)}`;
}

/** Item 15's route between the departure and the destination: airways
 *  between the fixes they are joined and left at, and DCT between two
 *  fixes flown direct (AIM Appendix 4: "DALL3 EIC V18 MEI LGC4", "FLACK
 *  DCT IRW"); DCT alone for a flight direct from one to the other. */
export function routeItem(stops: string[], isAirway: (stop: string) => boolean): string {
  const words: string[] = [];
  stops.forEach((stop, i) => {
    if (i > 0 && !isAirway(stop) && !isAirway(stops[i - 1]!)) words.push("DCT");
    words.push(stop);
  });
  return words.length ? words.join(" ") : "DCT";
}

/** An identifier with a figure in it (C81, 06A) is the FAA's own, with no
 *  ICAO four-letter location indicator. */
const noIndicator = (ident: string) => /\d/.test(ident);

function zzzz(ident: string, slot: "DEP" | "DEST" | "ALTN"): string | undefined {
  return noIndicator(ident)
    ? `Where a filing service takes only four-letter indicators: ZZZZ, and ${slot}/${ident} in item 18 (AIM Appendix 4).`
    : undefined;
}

const altitude = (ft: number) => `${Math.round(ft).toLocaleString("en-US")} ft`;

/** The route's flights, landing to landing, with the stops each flies
 *  through and the legs that fly it. */
function flights(input: FormInput) {
  const ends = [input.dep, ...input.landings, input.dest];
  const out: { departure: string; destination: string; via: string[]; legs: Leg[] }[] = [];
  let at = 0;
  let stop = 0;
  for (let i = 0; i < ends.length - 1; i++) {
    const destination = ends[i + 1]!;
    const via: string[] = [];
    while (stop < input.route.length && (i === ends.length - 2 || input.route[stop] !== destination)) via.push(input.route[stop++]!);
    stop++;
    const legs: Leg[] = [];
    while (at < input.legs.length) {
      const leg = input.legs[at++]!;
      legs.push(leg);
      if (leg.to === destination && i < ends.length - 2) break;
    }
    out.push({ departure: ends[i]!, destination, via, legs });
  }
  return out;
}

export function flightPlanForms(input: FormInput): FlightPlanForm[] {
  const ifr = input.rules === "ifr";
  const hops = flights(input);
  return hops.map((hop, i) => {
    const totals = hops.length > 1 ? input.totals?.hops?.[i]?.totals ?? null : input.totals;
    const first = hop.legs[0];
    const last = i === hops.length - 1;
    const items: FormItem[] = [];
    const add = (item: string, key: string, label: string, value: string | null, note?: string) =>
      items.push({ item, key, label, value, ...(note ? { note } : {}) });

    add("8", "rules", "Flight rules", ifr ? "IFR" : "VFR");
    add("7", "ident", "Aircraft identification", input.aircraft.ident);
    // Item 9's wake turbulence category: L up to a maximum certificated
    // takeoff weight of 15,500 lb (AIM Appendix 4, from FAA Order JO
    // 7360.1); said only where the airplane's is known.
    const wake = input.aircraft.maxTakeoffLb != null && input.aircraft.maxTakeoffLb <= 15_500 ? "/L" : "";
    add("9", "type", "Type of aircraft", input.aircraft.type ? `${input.aircraft.type}${wake}` : null);

    add("13", "departure", "Departure", hop.departure, zzzz(hop.departure, "DEP"));
    // Item 13's time is UTC, four figures; a later flight's is when the
    // airplane leaves the stop, which the plan does not know.
    const depart = i === 0 ? input.depart : null;
    add("13", "time", "Departure time (UTC)", depart ? `${pad(depart.getUTCHours(), 2)}${pad(depart.getUTCMinutes(), 2)}` : null,
      i > 0 ? `When you leave ${hop.departure}.` : depart ? undefined : "No departure time picked.");

    add("15", "speed", "Cruising speed", first ? cruisingSpeed(first.tas_kt) : null);
    // The level of the flight's first leg; a plan that steps says where.
    // Under IFR the next is asked of ATC on the way: the FAA's systems
    // neither process nor show a change filed in item 15 (AIM Appendix 4).
    const step = first ? hop.legs.find(leg => leg.altitude_ft !== first.altitude_ft) : undefined;
    add("15", "level", "Cruising level", first ? cruisingLevel(first.altitude_ft) : null,
      step ? `Then ${altitude(step.altitude_ft)} from ${step.from}${ifr ? ", asked of ATC on the way" : ""}.` : undefined);

    // A T route, or a Q route, asks for GNSS and RNAV 2 (AIM Appendix 4,
    // TBL 4-13): filed only where the airplane is equipped and approved.
    const rnav = hop.via.some(stop => input.isAirway(stop) && /^[TQ]/.test(stop));
    add("15", "route", "Route", routeItem(hop.via, input.isAirway),
      rnav ? "A T or Q route asks for G and R in item 10a and PBN/C2 in item 18, where the airplane has them (AIM Appendix 4)." : undefined);

    add("16", "destination", "Destination", hop.destination, zzzz(hop.destination, "DEST"));
    add("16", "eet", "Total EET", totals?.ete_min != null ? hoursMinutes(Math.ceil(totals.ete_min)) : null);
    const alternate = ifr && last ? input.alternate : null;
    if (alternate) add("16", "alternate", "Alternate", alternate, zzzz(alternate, "ALTN"));

    // Item 18's date of flight, where it is not today (AIM Appendix 4,
    // TBL 4-1): the UTC date, YYMMDD.
    if (depart && depart.toISOString().slice(0, 10) !== input.now.toISOString().slice(0, 10)) {
      add("18", "other", "Other information", `DOF/${pad(depart.getUTCFullYear() % 100, 2)}${pad(depart.getUTCMonth() + 1, 2)}${pad(depart.getUTCDate(), 2)}`);
    }

    // Item 19's endurance: the fuel aboard at the cruise burn, to the
    // minute below.
    const fuel = i === 0 ? input.fuelGal ?? totals?.usable_fuel_gal ?? null : totals?.usable_fuel_gal ?? null;
    const burn = first?.fuel_burn_gph;
    add("19", "endurance", "Endurance", fuel != null && burn ? hoursMinutes(Math.floor((fuel / burn) * 60)) : null,
      fuel != null && burn ? `${Math.round(fuel * 10) / 10} gal at ${Math.round(burn * 10) / 10} gph.` : undefined);

    return { departure: hop.departure, destination: hop.destination, items };
  });
}

/** A form as text, an item to a line, to paste or read out. */
export function formText(form: FlightPlanForm): string {
  return [
    `${form.departure} to ${form.destination}`,
    ...form.items.map(f => `${f.item} ${f.label}: ${f.value ?? "—"}`),
  ].join("\n");
}
