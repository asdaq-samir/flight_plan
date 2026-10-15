/**
 * GDL 90, the message format cockpit ADS-B receivers send their traffic
 * and position in over Wi-Fi -- Stratux, uAvionix's SkyEcho, ForeFlight's
 * Sentry among them -- as the FAA's GDL 90 Data Interface Specification
 * (Garmin 560-1058-00, Rev A) gives it: messages framed by 0x7E flags,
 * with 0x7D escaping a flag or itself inside (XOR 0x20), each its message
 * ID, its data and a CRC-16-CCITT over both, least significant byte
 * first (spec §2.2). Read here: the heartbeat (§3.1), the ownship report
 * (§3.4) and its geometric altitude (§3.8), the traffic report (§3.5),
 * whose fields the ownship report shares, and the uplink (§3.3), FIS-B's
 * broadcast from the ground stations (lib/fisb).
 */

/** The spec's CRC table (§2.2.3): polynomial 0x1021, no reflection. */
const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = (i << 8) & 0xffff;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
    table[i] = crc;
  }
  return table;
})();

/** The spec's CRC over a message's ID and data (§2.2.3). */
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = (CRC_TABLE[crc >> 8]! ^ ((crc << 8) & 0xffff) ^ byte) & 0xffff;
  return crc;
}

/** A datagram's messages, unframed and unescaped, each its ID and data
 *  without the CRC; one whose CRC does not match is left out. */
export function messages(datagram: Uint8Array): Uint8Array[] {
  const found: Uint8Array[] = [];
  let current: number[] | null = null;
  let escaped = false;
  for (const byte of datagram) {
    if (byte === 0x7e) {
      if (current && current.length >= 3) {
        const body = Uint8Array.from(current.slice(0, -2));
        const sent = current[current.length - 2]! | (current[current.length - 1]! << 8);
        if (crc16(body) === sent) found.push(body);
      }
      current = [];
      escaped = false;
    } else if (current) {
      if (byte === 0x7d) escaped = true;
      else {
        current.push(escaped ? byte ^ 0x20 : byte);
        escaped = false;
      }
    }
  }
  return found;
}

/** A message framed as a receiver sends it (§2.2), for the tests. */
export function frame(body: Uint8Array): Uint8Array {
  const crc = crc16(body);
  const out = [0x7e];
  for (const byte of [...body, crc & 0xff, crc >> 8]) {
    if (byte === 0x7e || byte === 0x7d) out.push(0x7d, byte ^ 0x20);
    else out.push(byte);
  }
  out.push(0x7e);
  return Uint8Array.from(out);
}

/** A 24-bit two's-complement figure, as latitude and longitude are sent. */
const signed24 = (value: number) => (value & 0x800000 ? value - 0x1000000 : value);

/** The emergency or priority code (§3.5.1.12), where there is one. */
const EMERGENCIES: Record<number, string> = {
  1: "general", 2: "lifeguard", 3: "minfuel", 4: "nordo", 5: "unlawful", 6: "downed",
};

/** A traffic or ownship report (§3.5.1): who, where, how high and fast. */
export interface Gdl90Report {
  /** The ICAO address as adsb.lol writes it (six hex digits), a
   *  self-assigned or TIS-B track's prefixed "~" as adsb.lol does. */
  hex: string;
  lat: number;
  lon: number;
  /** Pressure altitude, feet (29.92 inHg), to 25 ft; null where invalid. */
  altitudeFt: number | null;
  airborne: boolean;
  /** Ground speed, knots; null where unavailable. */
  speedKt: number | null;
  /** Feet a minute, to 64; null where unavailable. */
  verticalFpm: number | null;
  /** True track or heading, degrees; null where invalid. */
  trackDeg: number | null;
  callsign: string | null;
  emergency: string | null;
  /** Whether the position is valid: a report with NIC 0 has none. */
  positioned: boolean;
}

/** A traffic or ownship report's data (§3.5.1), after its message ID. */
export function report(body: Uint8Array): Gdl90Report | null {
  if (body.length < 28) return null;
  const b = (i: number) => body[i]!;
  const addressType = b(1) & 0x0f;
  const address = ((b(2) << 16) | (b(3) << 8) | b(4)).toString(16).padStart(6, "0");
  const lat = signed24((b(5) << 16) | (b(6) << 8) | b(7)) * 180 / 0x800000;
  const lon = signed24((b(8) << 16) | (b(9) << 8) | b(10)) * 180 / 0x800000;
  // 12 bits of altitude, 25 ft from -1,000 ft; 0xFFF invalid (§3.5.1.4).
  const altitude = (b(11) << 4) | (b(12) >> 4);
  const misc = b(12) & 0x0f;
  const nic = b(13) >> 4;
  const horizontal = (b(14) << 4) | (b(15) >> 4);
  const verticalRaw = ((b(15) & 0x0f) << 8) | b(16);
  const vertical = verticalRaw & 0x800 ? verticalRaw - 0x1000 : verticalRaw;
  const trackType = misc & 0x03;
  const callsign = String.fromCharCode(...body.slice(19, 27)).replace(/[^ -~]/g, "").trim();
  return {
    // ICAO addresses (ADS-B and TIS-B, types 0 and 2) as they are; the
    // rest, which name no airframe, marked as adsb.lol marks them.
    hex: addressType === 0 || addressType === 2 ? address : `~${address}`,
    lat, lon,
    altitudeFt: altitude === 0xfff ? null : altitude * 25 - 1000,
    airborne: (misc & 0x08) !== 0,
    speedKt: horizontal === 0xfff ? null : horizontal,
    verticalFpm: verticalRaw === 0x800 ? null : vertical * 64,
    trackDeg: trackType === 0 ? null : b(17) * 360 / 256,
    callsign: callsign || null,
    emergency: EMERGENCIES[b(27) >> 4] ?? null,
    positioned: nic !== 0 || lat !== 0 || lon !== 0,
  };
}

/** What a datagram said, message by message. */
export type Gdl90Message =
  | { kind: "heartbeat"; gpsValid: boolean }
  | { kind: "ownship"; report: Gdl90Report }
  | { kind: "ownship-altitude"; geometricFt: number }
  | { kind: "traffic"; report: Gdl90Report }
  | { kind: "uplink"; payload: Uint8Array };

/** A datagram read: the messages this app uses, the rest left out. */
export function read(datagram: Uint8Array): Gdl90Message[] {
  const out: Gdl90Message[] = [];
  for (const body of messages(datagram)) {
    switch (body[0]) {
      case 0x00:
        // Status byte 1, bit 7: GPS position valid (§3.1.1).
        if (body.length >= 7) out.push({ kind: "heartbeat", gpsValid: (body[1]! & 0x80) !== 0 });
        break;
      case 0x0a: {
        const own = report(body);
        if (own) out.push({ kind: "ownship", report: own });
        break;
      }
      case 0x0b:
        // Geometric altitude, a signed 16 bits of 5 ft (§3.8).
        if (body.length >= 3) {
          const raw = (body[1]! << 8) | body[2]!;
          out.push({ kind: "ownship-altitude", geometricFt: (raw & 0x8000 ? raw - 0x10000 : raw) * 5 });
        }
        break;
      case 0x14: {
        const traffic = report(body);
        if (traffic) out.push({ kind: "traffic", report: traffic });
        break;
      }
      case 0x07:
        // The time it was heard (3 bytes), then the UAT uplink payload's
        // 432 bytes (§3.3).
        if (body.length >= 436) out.push({ kind: "uplink", payload: body.subarray(4, 436) });
        break;
    }
  }
  return out;
}
