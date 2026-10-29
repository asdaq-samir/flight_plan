import { useEffect, useState } from "react";
import { create } from "zustand";
import type { Metar, TrafficAircraft } from "../api/types";
import { uplinkReports, type TextReport } from "../fisb";
import { read, type Gdl90Report } from "../gdl90";
import { observedAt } from "../reportTime";
import { sameField } from "../procedures";
import type { Report } from "./tracking";

/**
 * A cockpit ADS-B receiver -- Stratux, uAvionix's SkyEcho, ForeFlight's
 * Sentry -- heard over the cockpit's Wi-Fi in GDL 90 (lib/gdl90), at the
 * owner's ask (#191: the internet's traffic when it can be had, and a
 * receiver's): its traffic straight from the airplanes' transponders and
 * the ground stations' TIS-B, seconds fresher than the internet's and with
 * no internet at all, merged with adsb.lol's by ICAO address
 * (TrafficLayer). Only the iOS and Android apps can hear it: a web page
 * cannot receive UDP, so the apps' own Gdl90 plugin listens on port 4000,
 * where these receivers send, and hands each datagram to the page.
 *
 * Its heights are pressure altitudes (GDL 90 §3.5.1.4); where the receiver
 * reports own ship's pressure and geometric altitudes both (§3.4, §3.8),
 * each airplane's is given as geometric by their difference, as own
 * ship's GPS height is, so the two compare as like with like.
 *
 * And the weather the FAA's ground stations broadcast on UAT, FIS-B
 * (lib/fisb), where the receiver hears 978 MHz: each station's latest
 * METAR and TAF as sent, for the card's weather where the internet's is
 * older or cannot be had (lib/metarText).
 */
interface Receiver {
  /** The app is listening for one (Traffic on, in the app). */
  listening: boolean;
  /** One has been heard in the last CONNECTED_MS. */
  connected: boolean;
  heardAt: number | null;
  /** The receiver's own GPS has a position (its heartbeat). */
  gpsValid: boolean;
  /** Own ship's transponder address, as the receiver reports it: left out
   *  of the traffic, as own ship's own echo. */
  ownHex: string | null;
  /** Own ship's pressure altitude and geometric height, feet, with when. */
  ownPressureFt: number | null;
  ownGeometricFt: number | null;
  traffic: Record<string, Report>;
  /** FIS-B's text reports, each station's latest of a kind: METAR (a
   *  SPECI among them) and TAF, by station as sent ("KDLH"). */
  metars: Record<string, HeardReport>;
  tafs: Record<string, HeardReport>;
  error: string | null;
}

/** A text report heard, with when it was heard. */
export interface HeardReport {
  report: TextReport;
  at: number;
}

/** Heard within this long, a receiver is connected. */
const CONNECTED_MS = 5000;
/** An airplane not reported for this long is dropped. */
const KEEP_MS = 20_000;

export const useReceiver = create<Receiver>(() => ({
  listening: false, connected: false, heardAt: null, gpsValid: false, ownHex: null,
  ownPressureFt: null, ownGeometricFt: null, traffic: {}, metars: {}, tafs: {}, error: null,
}));

/** Each station's latest, the reports heard put in: a newer one is never
 *  replaced by an older one heard after, as the ground stations repeat
 *  theirs. */
function latest(kept: Record<string, HeardReport>, heard: TextReport[], now: number) {
  const when = (r: TextReport) => observedAt(r.time, new Date(now)) ?? "";
  let out = kept;
  for (const report of heard) {
    const held = out[report.station];
    if (held && when(held.report) > when(report)) continue;
    out = { ...out, [report.station]: { report, at: now } };
  }
  return out;
}

/** A report as the map draws an airplane (TrafficAircraft): its height
 *  geometric where own ship's two heights give the difference. */
function aircraftOf(report: Gdl90Report, offsetFt: number | null): TrafficAircraft {
  return {
    hex: report.hex, callsign: report.callsign, registration: null, type: null,
    lat: Math.round(report.lat * 1e5) / 1e5, lon: Math.round(report.lon * 1e5) / 1e5,
    altitude_ft: report.altitudeFt === null ? null : report.altitudeFt + (offsetFt ?? 0),
    pressure_altitude: offsetFt === null,
    track_deg: report.trackDeg, speed_kt: report.speedKt, vertical_fpm: report.verticalFpm,
    seen_s: 0, squawk: null, emergency: report.emergency,
  };
}

/** One datagram from the receiver, into the store. */
export function ingest(datagram: Uint8Array, now = Date.now()) {
  const said = read(datagram);
  if (!said.length) return;
  useReceiver.setState(s => {
    let { ownHex, ownPressureFt, ownGeometricFt, gpsValid, metars, tafs } = s;
    const traffic = { ...s.traffic };
    for (const message of said) {
      if (message.kind === "uplink") {
        const reports = uplinkReports(message.payload);
        metars = latest(metars, reports.filter(r => r.kind === "METAR" || r.kind === "SPECI"), now);
        tafs = latest(tafs, reports.filter(r => r.kind.startsWith("TAF")), now);
      } else if (message.kind === "heartbeat") gpsValid = message.gpsValid;
      else if (message.kind === "ownship") {
        ownHex = message.report.hex;
        ownPressureFt = message.report.altitudeFt;
      } else if (message.kind === "ownship-altitude") ownGeometricFt = message.geometricFt;
    }
    const offset = ownPressureFt !== null && ownGeometricFt !== null ? ownGeometricFt - ownPressureFt : null;
    for (const message of said) {
      if (message.kind !== "traffic") continue;
      const { report } = message;
      // On the ground, or with no position: not drawn, as adsb.lol's are not.
      if (!report.airborne || !report.positioned || report.hex === ownHex) continue;
      traffic[report.hex] = { plane: aircraftOf(report, offset), at: now };
    }
    for (const [hex, held] of Object.entries(traffic)) if (now - held.at > KEEP_MS) delete traffic[hex];
    return { heardAt: now, connected: true, gpsValid, ownHex, ownPressureFt, ownGeometricFt, traffic, metars, tafs };
  });
}

/** Base64, as the plugin hands a datagram over, as bytes. */
function bytesOf(base64: string): Uint8Array {
  const text = atob(base64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

interface Gdl90Plugin {
  start(options: { port: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "packet", listener: (packet: { data: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

/** GDL 90's own port, where Stratux, SkyEcho and Sentry send. */
const PORT = 4000;

/**
 * Listening for a receiver, in the app (the Gdl90 plugin, web/ios and
 * web/android): each datagram read into the store, and the receiver said
 * gone once quiet for CONNECTED_MS. Answers a function that stops.
 */
export async function listen(): Promise<() => void> {
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<Gdl90Plugin>("Gdl90");
  const handle = await plugin.addListener("packet", packet => ingest(bytesOf(packet.data)));
  try {
    await plugin.start({ port: PORT });
    useReceiver.setState({ listening: true, error: null });
  } catch (err) {
    useReceiver.setState({ listening: false, error: err instanceof Error ? err.message : String(err) });
  }
  const timer = window.setInterval(() => {
    const { heardAt, connected, traffic } = useReceiver.getState();
    const now = Date.now();
    if (connected && (heardAt === null || now - heardAt > CONNECTED_MS)) useReceiver.setState({ connected: false });
    const kept = Object.fromEntries(Object.entries(traffic).filter(([, held]) => now - held.at <= KEEP_MS));
    if (Object.keys(kept).length !== Object.keys(traffic).length) useReceiver.setState({ traffic: kept });
  }, 1000);
  return () => {
    window.clearInterval(timer);
    void handle.remove();
    void plugin.stop();
    useReceiver.setState({ listening: false, connected: false, traffic: {} });
  };
}

/** The receiver's latest TAF of a field as sent, for the card's hours
 *  (lib/hourly) where the planner's could not be had; null where none
 *  has been heard. */
export function useHeardTaf(ident: string | null | undefined): string | null {
  return useReceiver(s => (ident ? Object.values(s.tafs).find(h => sameField(h.report.station, ident))?.report.text ?? null : null));
}

/** The receiver's latest METAR of a field, read (lib/metarText); null
 *  where none has been heard. A field's FAA identifier (DLH) finds its
 *  ICAO station (KDLH). */
export function useHeardMetar(ident: string | null | undefined): Metar | null {
  const heard = useReceiver(s => (ident ? Object.values(s.metars).find(h => sameField(h.report.station, ident)) ?? null : null));
  // The reader (metar-taf-parser) loads when a report is first heard:
  // only the apps with a receiver ever need it.
  const [read, setRead] = useState<{ heard: HeardReport; metar: Metar | null } | null>(null);
  useEffect(() => {
    if (!heard) return;
    let live = true;
    void import("../metarText").then(m => {
      if (live) setRead({ heard, metar: m.metarOf(heard.report.text, new Date(heard.at)) });
    });
    return () => { live = false; };
  }, [heard]);
  return heard && read?.heard === heard ? read.metar : null;
}
