import {
  CloudQuantity, Descriptive, DistanceUnit, Phenomenon, SpeedUnit, WeatherChangeType,
  getCompositeForecastForDate, parseMetar, parseTAFAsForecast,
  type Forecast, type IAbstractWeatherContainer, type IForecastContainer,
} from "metar-taf-parser";
import type { Metar } from "./api/types";
import { categoryOf } from "./map/flightCategory";
import { clockTime } from "./clock";
import { altFt } from "./units";

/**
 * A field's weather hour by hour, as Apple's Weather lays out its hourly
 * forecast, for the airport card (HourlyForecast): Now from the METAR,
 * then each whole hour the field's TAF covers, and one plain sentence of
 * what it says -- written here from the figures, the same words for the
 * same forecast, no model in it.
 *
 * The TAF is read by metar-taf-parser, its change groups as AC 00-45H
 * (Aviation Weather Services) sets them out: the forecast's first line
 * and each FM group the prevailing weather until the next; a BECMG a
 * change that happens somewhere in its window and holds after it, so
 * until it is done the hour is the worse of before and after (the stock
 * parser's own composite takes the new weather from the window's start,
 * which is right only when it gets worse); a TEMPO, PROB or INTER group
 * weather that comes and goes, which is not the hour's bar but its
 * "at times" (`atTimes`), drawn lighter under it and said in the
 * sentence. The ceiling is 14 CFR 1.1's -- the lowest layer broken or
 * overcast, or the vertical visibility into an obscuration -- and the
 * flight category AIM 7-1-7's, by the one rule the app has for it
 * (categoryOf).
 */

const HOUR_MS = 3_600_000;
/** How many hours after Now: a TAF covers 24 or 30 (AC 00-45H). */
export const HOURS = 24;
/** How far ahead the sentence looks: a flight's day, not the TAF's end. */
const SENTENCE_HOURS = 12;

const KT_PER_MPS = 1.943844;
const KT_PER_KMH = 0.539957;
const SM_PER_M = 1 / 1609.344;
/** CAVOK: ten kilometres or more and no cloud under 5,000 ft (ICAO
 *  Annex 3, Appendix 3, 2.2), from a station outside the US -- as good as
 *  a US TAF's P6SM, more than 6 statute miles. */
const CAVOK_SM = 6;

/** What the sky is, for the hour's glyph: clear (or no cloud said),
 *  few or scattered, and broken, overcast or obscured. */
export type Sky = "clear" | "partly" | "cloudy";
/** The weather worth a glyph of its own, the worst first. */
export type Precip = "thunder" | "snow" | "rain";

export interface Hour {
  /** The hour's start, ms; Now's is the report's time (or now). */
  at: number;
  now: boolean;
  category: string | null;
  ceilingFt: number | null;
  visibilitySm: number | null;
  sky: Sky | null;
  precip: Precip | null;
  /** True, as reports and forecasts give it; null where variable. */
  windDirTrueDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** A TEMPO's or PROB's category this hour where it is worse than the
   *  prevailing one: the weather at times. */
  atTimes: string | null;
  /** The strongest gust at times, where it is above the prevailing's. */
  atTimesGustKt: number | null;
  /** Thunder at times, where the prevailing has none. */
  atTimesThunder: boolean;
}

const RANK: Record<string, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
const rank = (category: string | null) => (category ? RANK[category] ?? -1 : -1);

type Conditions = Pick<IAbstractWeatherContainer, "clouds" | "visibility" | "verticalVisibility" | "cavok" | "wind" | "weatherConditions">;

function ceilingOf(c: Conditions): number | null {
  const layers = c.clouds
    .filter(l => (l.quantity === CloudQuantity.BKN || l.quantity === CloudQuantity.OVC) && l.height != null)
    .map(l => l.height!);
  if (c.verticalVisibility != null) layers.push(c.verticalVisibility);
  return layers.length ? Math.min(...layers) : null;
}

function visibilityOf(c: Conditions): number | null {
  if (c.cavok) return CAVOK_SM;
  if (!c.visibility) return null;
  return c.visibility.unit === DistanceUnit.Meters ? Math.round(c.visibility.value * SM_PER_M * 100) / 100 : c.visibility.value;
}

function skyOf(c: Conditions): Sky {
  if (c.verticalVisibility != null || c.clouds.some(l => l.quantity === CloudQuantity.BKN || l.quantity === CloudQuantity.OVC)) return "cloudy";
  if (c.clouds.some(l => l.quantity === CloudQuantity.FEW || l.quantity === CloudQuantity.SCT)) return "partly";
  return "clear";
}

const SNOW = new Set<Phenomenon>([Phenomenon.SNOW, Phenomenon.SNOW_GRAINS, Phenomenon.ICE_PELLETS, Phenomenon.ICE_CRYSTALS, Phenomenon.HAIL, Phenomenon.SMALL_HAIL]);
const RAIN = new Set<Phenomenon>([Phenomenon.RAIN, Phenomenon.DRIZZLE, Phenomenon.UNKNOW_PRECIPITATION]);

function precipOf(c: Conditions): Precip | null {
  const w = c.weatherConditions;
  if (w.some(x => x.descriptive === Descriptive.THUNDERSTORM || x.phenomenons.includes(Phenomenon.THUNDERSTORM))) return "thunder";
  if (w.some(x => x.phenomenons.some(p => SNOW.has(p)))) return "snow";
  if (w.some(x => x.phenomenons.some(p => RAIN.has(p)))) return "rain";
  return null;
}

function knots(speed: number | undefined, unit: SpeedUnit | undefined): number | null {
  if (speed == null) return null;
  if (unit === SpeedUnit.MetersPerSecond) return Math.round(speed * KT_PER_MPS);
  if (unit === SpeedUnit.KilometersPerHour) return Math.round(speed * KT_PER_KMH);
  return speed;
}

/** One forecast's figures; `under`, the prevailing forecast whose cloud
 *  and visibility a TEMPO that leaves them out keeps. */
function figuresOf(c: Conditions, under?: Conditions) {
  const merged: Conditions = under ? {
    ...c,
    clouds: c.clouds.length || c.verticalVisibility != null ? c.clouds : under.clouds,
    verticalVisibility: c.clouds.length || c.verticalVisibility != null ? c.verticalVisibility : under.verticalVisibility,
    visibility: c.visibility ?? (c.cavok ? undefined : under.visibility),
    cavok: c.cavok ?? (c.visibility || c.clouds.length ? undefined : under.cavok),
  } : c;
  const ceilingFt = ceilingOf(merged), visibilitySm = visibilityOf(merged);
  return {
    category: categoryOf(ceilingFt, visibilitySm), ceilingFt, visibilitySm,
    sky: skyOf(merged), precip: precipOf(c),
    windDirTrueDeg: c.wind?.degrees ?? null, windSpeedKt: knots(c.wind?.speed, c.wind?.unit), windGustKt: knots(c.wind?.gust, c.wind?.unit),
  };
}

/** The first line and the FM and BECMG groups: what prevails until the next. */
const prevails = (f: Forecast) => f.type === undefined || f.type === WeatherChangeType.FM || f.type === WeatherChangeType.BECMG;

/** The TAF read, its times dated from `now` (a TAF's are day and hour
 *  only); null where there is none or it does not read. FIS-B sends an
 *  amendment as "TAF.AMD". */
export function tafOf(raw: string | null | undefined, now: number): IForecastContainer | null {
  if (!raw) return null;
  try {
    return parseTAFAsForecast(raw.replace(/\s+/g, " ").trim().replace(/^TAF\.AMD /, "TAF AMD ").replace(/=$/, ""), { issued: new Date(now) });
  } catch {
    return null;
  }
}

/** The TAF's hour starting `at`; null outside its validity. */
function hourAt(taf: IForecastContainer, at: number): Omit<Hour, "now"> | null {
  let composite;
  try {
    composite = getCompositeForecastForDate(new Date(at), taf);
  } catch {
    return null;
  }
  const { prevailing, supplemental } = composite;
  let figures = figuresOf(prevailing);
  // A BECMG still under way: the worse of the weather before and after.
  if (prevailing.type === WeatherChangeType.BECMG && at < prevailing.by.getTime()) {
    const before = taf.forecast.filter(f => prevails(f) && f.start.getTime() < prevailing.start.getTime()).at(-1);
    const was = before && figuresOf(before);
    if (was && rank(was.category) > rank(figures.category)) figures = { ...was, windDirTrueDeg: figures.windDirTrueDeg, windSpeedKt: figures.windSpeedKt, windGustKt: figures.windGustKt };
  }
  let atTimes: string | null = null, atTimesGustKt: number | null = null, atTimesThunder = false;
  for (const group of supplemental) {
    const then = figuresOf(group, prevailing);
    if (rank(then.category) > rank(figures.category) && rank(then.category) > rank(atTimes)) atTimes = then.category;
    const gust = then.windGustKt;
    if (gust != null && gust > (figures.windGustKt ?? 0) && gust > (atTimesGustKt ?? 0)) atTimesGustKt = gust;
    if (then.precip === "thunder" && figures.precip !== "thunder") atTimesThunder = true;
  }
  return { at, ...figures, atTimes, atTimesGustKt, atTimesThunder };
}

/** Now, from the field's METAR: its figures as the planner (or own
 *  ship's receiver) read them, and its sky and weather from its text. */
function nowOf(metar: Metar, now: number): Hour {
  let sky: Sky | null = metar.ceiling_ft != null ? "cloudy" : null;
  let precip: Precip | null = null;
  if (metar.raw) {
    try {
      const read = parseMetar(metar.raw.replace(/\s+/g, " ").trim().replace(/=$/, ""));
      sky = skyOf(read);
      precip = precipOf(read);
    } catch {
      // Not read: the ceiling's cloud, or no glyph.
    }
  }
  const observed = metar.observed_at ? Date.parse(metar.observed_at) : NaN;
  return {
    at: Number.isNaN(observed) ? now : observed, now: true,
    category: metar.flight_category ?? null, ceilingFt: metar.ceiling_ft ?? null, visibilitySm: metar.visibility_sm ?? null,
    sky, precip,
    windDirTrueDeg: metar.wind_dir_true_deg ?? null, windSpeedKt: metar.wind_speed_kt ?? null, windGustKt: metar.wind_gust_kt ?? null,
    atTimes: null, atTimesGustKt: null, atTimesThunder: false,
  };
}

/** Now and the hours after it: Now the METAR's, or with none the TAF's
 *  for this moment; then each whole hour the TAF covers, up to `count`. */
export function hoursOf({ metar, taf, now, count = HOURS }: { metar: Metar | null; taf: IForecastContainer | null; now: number; count?: number }): Hour[] {
  const hours: Hour[] = [];
  if (metar) hours.push(nowOf(metar, now));
  else if (taf) {
    const here = hourAt(taf, now);
    if (here) hours.push({ ...here, at: now, now: true });
  }
  if (!taf) return hours;
  const end = taf.end.getTime();
  for (let at = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS, n = 0; n < count && at < end; at += HOUR_MS) {
    const hour = hourAt(taf, at);
    if (hour) {
      hours.push({ ...hour, now: false });
      n++;
    }
  }
  return hours;
}

/** "17:00": this device's clock, as the Brief writes a forecast's times. */
const clock = (ms: number) => clockTime(new Date(ms));

/**
 * The forecast in a sentence or two, over the hours: when the category
 * changes in the next twelve hours, to what and until when -- led by
 * what changes it, the ceiling or the visibility -- or that it stays;
 * the worse weather a TEMPO or PROB gives at times; thunderstorms; and
 * the strongest gust. With no TAF, the category now and that there is no
 * forecast. Null with nothing to say from.
 */
export function sentenceOf(hours: Hour[], time: (ms: number) => string = clock): string | null {
  if (!hours.length) return null;
  const forecast = hours.filter(h => !h.now);
  const first = hours[0]!;
  if (!forecast.length) return first.category ? `${first.category} now, no forecast for this field.` : "No forecast for this field.";
  const within = hours.filter(h => h.at <= first.at + SENTENCE_HOURS * HOUR_MS);
  const last = hours.at(-1)!;
  const said: string[] = [];

  const from = within.findIndex(h => h.category != null);
  const was = from >= 0 ? within[from]!.category! : null;
  const change = was ? within.findIndex((h, i) => i > from && h.category != null && h.category !== was) : -1;
  if (was && change >= 0) {
    const turn = within[change]!;
    const to = turn.category!;
    const after = hours.findIndex(h => h.at > turn.at && h.category != null && h.category !== to);
    const lasting = after >= 0 ? `until ${time(hours[after]!.at)}` : `through ${time(last.at)}`;
    if (rank(to) > rank(was)) {
      // Led by what brings it down: the ceiling where it alone would make
      // the category, else the visibility.
      const byCeiling = turn.ceilingFt != null && rank(categoryOf(turn.ceilingFt, Infinity)) >= rank(to);
      said.push(byCeiling ? `Ceilings lowering to ${altFt(turn.ceilingFt)} ft around ${time(turn.at)}, ${to} ${lasting}.`
        : turn.visibilitySm != null ? `Visibility down to ${turn.visibilitySm} sm around ${time(turn.at)}, ${to} ${lasting}.`
          : `${to} from around ${time(turn.at)} ${lasting}.`);
    } else {
      said.push(`${was} ${within[from]!.now ? "now" : "at first"}, ${to} from around ${time(turn.at)}${after >= 0 ? ` ${lasting}` : ""}.`);
    }
  } else if (was) {
    said.push(`Staying ${was} through ${time(within.at(-1)!.at)}.`);
  }

  // The first stretch of worse weather at times, from its first hour to
  // the end of its last.
  const start = within.findIndex(h => h.atTimes != null);
  if (start >= 0) {
    const worst = within[start]!.atTimes!;
    let end = start;
    while (end + 1 < within.length && within[end + 1]!.atTimes != null) end++;
    said.push(`At times ${worst} between ${time(within[start]!.at)} and ${time(within[end]!.at + HOUR_MS)}.`);
  }

  const storm = within.find(h => h.precip === "thunder" || h.atTimesThunder);
  if (storm) said.push(storm.now ? "Thunderstorms now." : `Thunderstorms around ${time(storm.at)}.`);

  const gusts = within.flatMap(h => [h.windGustKt, h.atTimesGustKt]).filter((g): g is number => g != null && g > 0);
  if (gusts.length) said.push(`Gusts up to ${Math.round(Math.max(...gusts))} kt.`);

  return said.length ? said.join(" ") : null;
}

/** The hour a planned arrival falls in, its index in `hours`; null where
 *  it is before Now or past the last hour. */
export function arrivalHour(hours: Hour[], arrivalMs: number | null): number | null {
  if (arrivalMs == null || !hours.length) return null;
  const first = hours[0]!;
  if (arrivalMs < Math.floor(first.at / HOUR_MS) * HOUR_MS || arrivalMs >= hours.at(-1)!.at + HOUR_MS) return null;
  let found = 0;
  hours.forEach((h, i) => { if (!h.now && h.at <= arrivalMs) found = i; });
  return found;
}
