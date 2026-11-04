/**
 * An ATIS or AWOS/ASOS broadcast heard through the phone's microphone,
 * read into its figures by the engine (wingtip_engine::atis, the rule
 * read_atis; the native app's Atis), both held to the same fixture
 * (fixtures/atis.json). AIM 4-1-13 orders what an ATIS says: the letter,
 * the time, wind, visibility, sky, temperature and dew point, altimeter,
 * the approaches and runways in use, NOTAMs. The figures here are the
 * engine's; this file only listens and puts them into words.
 */
import { useAtcRadio } from "./atcRadio";
import { holdForListening } from "./audioInput";
import { callEngine } from "./engine/engine";
import { listen } from "./listen";
import { altFt } from "./units";

export interface AtisWind {
  from_deg: number | null;
  kt: number | null;
  gust_kt: number | null;
  variable: boolean;
}

export interface AtisLayer {
  cover: "clear" | "few" | "scattered" | "broken" | "overcast" | "obscured";
  base_ft: number | null;
}

export interface AtisReading {
  /** The information letter, "C". */
  information: string | null;
  /** "1852Z". */
  time_z: string | null;
  wind: AtisWind | null;
  visibility_sm: number | null;
  sky: AtisLayer[];
  temp_c: number | null;
  dewpoint_c: number | null;
  altimeter_inhg: number | null;
  /** "ILS runway 19R", "visual". */
  approach: string | null;
  runways: { landing: string[]; departing: string[] };
  /** What else was said, a clause each. */
  remarks: string[];
  /** The transcript as heard. */
  raw: string;
}

/** The broadcast read by the engine (the rule read_atis). */
export function readAtis(text: string): AtisReading {
  return callEngine<AtisReading>("read_atis", { text });
}

/** Whether anything of a broadcast was heard at all. */
export function heardAny(r: AtisReading): boolean {
  return r.information != null || r.time_z != null || r.wind != null || r.visibility_sm != null || r.sky.length > 0
    || r.altimeter_inhg != null || r.approach != null || r.runways.landing.length > 0 || r.runways.departing.length > 0;
}

/** The wind as a pilot says it back: "210° at 12 kt, gusts 18". */
export function windWords(w: AtisWind): string {
  if (w.kt === 0) return "Calm";
  const speed = w.kt != null ? `${w.kt} kt` : null;
  const gusts = w.gust_kt != null ? `gusts ${w.gust_kt}` : null;
  const head = w.from_deg != null ? `${String(w.from_deg).padStart(3, "0")}°${w.variable ? " variable" : ""}` : w.variable ? (speed ? "Variable" : "Light and variable") : null;
  return [head && speed ? `${head} at ${speed}` : head ?? speed, gusts].filter(Boolean).join(", ");
}

/** Statute miles as said: "10 sm", "2½ sm", "¾ sm". */
export function visibilityWords(sm: number): string {
  const whole = Math.floor(sm), frac = sm - whole;
  const part = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[frac] ?? (frac ? String(frac).slice(1) : "");
  return `${whole || !part ? whole : ""}${part} sm`;
}

/**
 * The layers as said, the ceiling marked: the lowest broken or overcast
 * layer, or an obscuration, is the ceiling (14 CFR 1.1's definition),
 * which is what the field's flight category hangs on.
 */
export function skyWords(sky: AtisLayer[]): string {
  if (!sky.length) return "—";
  const ceiling = sky.find(l => l.cover === "broken" || l.cover === "overcast" || l.cover === "obscured");
  return sky.map(l => {
    const cover = l.cover[0]!.toUpperCase() + l.cover.slice(1);
    return `${cover}${l.base_ft != null ? ` ${altFt(l.base_ft)} ft` : ""}${l === ceiling ? " (ceiling)" : ""}`;
  }).join(" · ");
}

/** The runways as said: both ways, or landing and departing apart. */
export function runwayWords(r: AtisReading["runways"]): string | null {
  const same = r.landing.length > 0 && r.landing.join() === r.departing.join();
  if (same) return r.landing.join(", ");
  const parts = [];
  if (r.landing.length) parts.push(`Landing ${r.landing.join(", ")}`);
  if (r.departing.length) parts.push(`Departing ${r.departing.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

/** The one line that matters at the hold-short line: the runway in use
 *  and the altimeter, with the letter. */
export function glanceWords(r: AtisReading): string {
  const runways = runwayWords(r.runways);
  return [
    runways ? `Runway ${runways}` : r.approach ? r.approach : null,
    r.altimeter_inhg != null ? `${r.altimeter_inhg.toFixed(2)} inHg` : null,
  ].filter(Boolean).join(" · ") || "Nothing of a broadcast was heard";
}

/** The table under the line, a row a figure, only the figures heard. */
export function atisRows(r: AtisReading): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (r.information) rows.push({ label: "Information", value: `${r.information}${r.time_z ? ` · ${r.time_z}` : ""}` });
  else if (r.time_z) rows.push({ label: "Observed", value: r.time_z });
  if (r.wind) rows.push({ label: "Wind", value: windWords(r.wind) });
  if (r.visibility_sm != null) rows.push({ label: "Visibility", value: visibilityWords(r.visibility_sm) });
  if (r.sky.length) rows.push({ label: "Sky", value: skyWords(r.sky) });
  if (r.temp_c != null) rows.push({ label: "Temperature", value: `${r.temp_c} °C${r.dewpoint_c != null ? `, dew point ${r.dewpoint_c} °C` : ""}` });
  if (r.altimeter_inhg != null) rows.push({ label: "Altimeter", value: `${r.altimeter_inhg.toFixed(2)} inHg` });
  if (r.approach) rows.push({ label: "Approach", value: r.approach });
  const runways = runwayWords(r.runways);
  if (runways) rows.push({ label: "Runways", value: runways });
  for (const remark of r.remarks) rows.push({ label: "Remarks", value: remark });
  return rows;
}

/** Once words have come, this long with no more ends the hearing, ms: an
 *  ATIS loops with a short pause between its readings. */
const PAUSE_MS = 3000;
/** With nothing heard at all, the hearing ends after this long, ms. */
const NOTHING_MS = 15000;
/** The hearing ends after this long whatever is said, ms: a broadcast
 *  is read in well under a minute. */
const LONGEST_MS = 75000;

/** What a hearing ended with: the words, the refusal in a pilot's words,
 *  and the outside input it was heard through, by its name. */
export interface AtisHeard {
  text: string;
  error?: string;
  through?: string;
}

/**
 * Hears one broadcast through lib/listen: the words so far to `onHeard`
 * as they come, and the whole once it ends, by its pause, by nothing
 * said, by `stop` or by time. `error` is the recognizer's refusal in a
 * pilot's words.
 *
 * Through the same input as the radio's (lib/audioInput), so the ground
 * test hears the panel the radio will (the owner's "Bluetooth is fine",
 * 2026-11-04); and not while the radio is listened to, which would be a
 * second recognizer on the one microphone.
 */
export function hearAtis(onHeard: (text: string) => void): { stop: () => void; done: Promise<AtisHeard> } {
  if (useAtcRadio.getState().listening) {
    return { stop: () => {}, done: Promise.resolve({ text: "", error: "The radio is being listened to; stop it in the Radio card first." }) };
  }
  const said = new Map<number, string>();
  let stopper: (() => void) | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stopper?.();
  };
  const typed = () => [...said.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join(" ");
  const done = new Promise<AtisHeard>(resolve => {
    let quiet = window.setTimeout(stop, NOTHING_MS);
    const longest = window.setTimeout(stop, LONGEST_MS);
    // In the tap, before the recognizer: the input held, or the one
    // remembered being opened.
    const input = holdForListening();
    void listen([], undefined, (id, text) => {
      if (!text) return;
      // A finished phrase given again under a new number, or the last
      // words with more after them, are the last result over again
      // (lib/atcListening's listenOnce, the same recognizer).
      const last = [...said.keys()].filter(k => k < id).sort((a, b) => b - a)[0];
      if (last !== undefined) {
        const before = said.get(last)!.toLowerCase(), now = text.toLowerCase();
        if (now === before || now.startsWith(before) || before.startsWith(now)) said.delete(last);
      }
      said.set(id, text);
      onHeard(typed());
      window.clearTimeout(quiet);
      quiet = window.setTimeout(stop, PAUSE_MS);
    }, error => {
      window.clearTimeout(quiet);
      window.clearTimeout(longest);
      const heardThrough = useAtcRadio.getState().input;
      input.release();
      resolve({ text: typed(), error, ...(heardThrough?.outside && !heardThrough.lost ? { through: heardThrough.label } : {}) });
    }, input.track).then(({ stop: s, renew }) => {
      input.follow(renew);
      stopper = s;
      if (stopped) s();
    });
  });
  return { stop, done };
}
