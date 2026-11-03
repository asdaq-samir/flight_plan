import { create } from "zustand";
import type { FlightStatus } from "./api/types";
import { clockTime } from "./clock";
import { compassPoint, saidPoint } from "./compass";
import { callEngine } from "./engine/engine";
import { altFt } from "./units";

/**
 * What a pilot can ask to be told of an airplane, from its card's Alert,
 * at the owner's pick of the redesign ("Tell me when N654FL…"): that it
 * takes off, that it lands, that it comes near own ship or near an
 * airport. Watched while the app is open (AircraftAlerts, every
 * FlightStatus a few seconds old), each said once on the map and aloud
 * as it happens, then let go, as FlightAware's alert for a flight is.
 */
export type AircraftAlertKind = "takeoff" | "land" | "near-me" | "near-airport";

export interface AircraftAlert {
  hex: string;
  /** Its name as its card shows it, for the banner and the voice. */
  name: string;
  kind: AircraftAlertKind;
  /** Near me: how near, nm (NEAR_ME_NM). */
  nm?: number;
  /** Near an airport: which. */
  airport?: { ident: string; name: string | null; lat: number; lon: number };
}

/** How near own ship an airplane is to come before it is said: the
 *  menu's choices, 10 nm first offered, as the mockup had it. */
export const NEAR_ME_NM = [5, 10, 20] as const;
export const NEAR_ME_DEFAULT_NM = 10;
/** How near an airport it is to come: ten miles, about five minutes out
 *  for a light airplane, time to be at the field to meet it. */
export const NEAR_AIRPORT_NM = 10;

/** An alert's own key, one of each kind an airplane. */
export const alertKey = (a: Pick<AircraftAlert, "hex" | "kind">) => `${a.hex}:${a.kind}`;

/** What the watcher keeps of an airplane between its answers: whether
 *  it was in the air -- null where that was not known -- and, for each
 *  alert near something, whether it was already that near. */
export interface Watched {
  airborne: boolean | null;
  inside: Record<string, boolean>;
}

/** An alert as it went off: the banner's words and the voice's. */
export interface FiredAlert {
  id: string;
  hex: string;
  name: string;
  title: string;
  detail: string | null;
  spoken: string;
  /** When, this device's clock (ms). */
  at: number;
}

/**
 * Whether the airplane is in the air, from its state and what was known
 * before: in the air where it is heard there; on the ground where it has
 * landed somewhere, or where nothing was known and it has not been heard
 * for half an hour or ever (parked out of the receivers' hearing); else
 * what was known, as an airplane gone quiet in the pattern has not landed
 * until it is known to have. The shared engine's rule
 * (native/engine/src/motion/alerts.rs), the phone's too.
 */
export function airborneNow(before: boolean | null, now: FlightStatus): boolean | null {
  return callEngine<boolean | null>("airborne_now", { before, airborne: !!now.airborne, arrived: !!now.arrived, heard_s: now.heard_s ?? null });
}

/** The engine's word on an alert (alert_fires): whether it goes off, and,
 *  near something, whether it is that near and how far which way. */
interface Fires { fires: boolean; inside: boolean | null; nm: number | null; bearing_deg: number | null }

/** "N654FL took off from 10C", "N654FL landed at KDAW", "N654FL is 8 nm
 *  from you": the banner's and the voice's words for one alert, or null
 *  where it has not gone off. `me` is own ship's fix, where it has one. */
export function fired(
  alert: AircraftAlert, before: Watched, airborne: boolean | null, now: FlightStatus,
  me: { lat: number; lon: number } | null, at: number,
): { alert: FiredAlert | null; inside?: boolean } {
  const id = `${alertKey(alert)}:${at}`;
  const base = { id, hex: alert.hex, name: alert.name, at };
  const when = clockTime(new Date(at));
  const nearMe = alert.kind === "near-me";
  // Near something: where it is now, against own ship or the airport.
  const plane = now.aircraft;
  const to = nearMe ? me : alert.airport ?? null;
  // When it goes off is the shared engine's (alert_fires); the words are
  // the page's.
  const go = callEngine<Fires>("alert_fires", {
    kind: alert.kind === "takeoff" || alert.kind === "land" ? alert.kind : "near",
    before_airborne: before.airborne, was_inside: !!before.inside[alertKey(alert)], airborne, arrived: !!now.arrived,
    plane: plane ? { lat: plane.lat, lon: plane.lon } : null, to: to ? { lat: to.lat, lon: to.lon } : null,
    limit_nm: nearMe ? alert.nm ?? NEAR_ME_DEFAULT_NM : NEAR_AIRPORT_NM,
  });
  if (alert.kind === "takeoff") {
    if (!go.fires) return { alert: null };
    const from = now.departed;
    return {
      alert: {
        ...base,
        title: from ? `${alert.name} took off from ${from.ident}` : `${alert.name} took off`,
        detail: [from?.city ?? from?.name, when].filter(Boolean).join(" · "),
        spoken: from ? `${alert.name} took off from ${from.name ?? from.ident}.` : `${alert.name} took off.`,
      },
    };
  }
  if (alert.kind === "land") {
    if (!go.fires || !now.arrived) return { alert: null };
    const field = now.arrived;
    return {
      alert: {
        ...base,
        title: `${alert.name} landed at ${field.ident}`,
        detail: [field.city ?? field.name, clockTime(new Date(field.at * 1000))].filter(Boolean).join(" · "),
        spoken: `${alert.name} landed at ${field.name ?? field.ident}.`,
      },
    };
  }
  if (go.inside === null) return { alert: null };
  if (!go.fires || !plane || go.nm === null || go.bearing_deg === null) return { alert: null, inside: go.inside };
  const miles = Math.max(1, Math.round(go.nm));
  const way = compassPoint(go.bearing_deg);
  const height = plane.altitude_ft == null ? null : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`;
  const where = nearMe ? "you" : alert.airport!.ident;
  return {
    inside: true,
    alert: {
      ...base,
      title: `${alert.name} is ${miles} nm from ${where}`,
      detail: [`${way} of ${nearMe ? "you" : alert.airport!.ident}`, height, when].filter(Boolean).join(" · "),
      spoken: nearMe
        ? `${alert.name}, ${miles} miles ${saidPoint(way)}${height ? `, ${height.replace(" ft", " feet")}` : ""}.`
        : `${alert.name} is ${miles} miles from ${alert.airport!.name ?? alert.airport!.ident}.`,
    },
  };
}

/** The alerts gone off and not yet put away, newest last (AircraftAlerts). */
export const useFiredAlerts = create<{ fired: FiredAlert[] }>(() => ({ fired: [] }));

export const dismissFired = (id: string) => useFiredAlerts.setState(s => ({ fired: s.fired.filter(f => f.id !== id) }));

/** "When it lands", "When it takes off or comes within 10 nm of you": the
 *  line under the card's name while alerts wait, as the mockup set one. */
export function alertsLine(alerts: AircraftAlert[]): string | null {
  const words = alerts.map(a => (a.kind === "takeoff" ? "takes off"
    : a.kind === "land" ? "lands"
      : a.kind === "near-me" ? `comes within ${a.nm ?? NEAR_ME_DEFAULT_NM} nm of you`
        : `comes within ${NEAR_AIRPORT_NM} nm of ${a.airport?.ident ?? "an airport"}`));
  if (!words.length) return null;
  const listed = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
  return `When it ${listed}`;
}
