/**
 * FIS-B, the weather and aeronautical text the FAA's ground stations
 * broadcast free on UAT (978 MHz) to a receiver in range and in line of
 * sight (AIM 7-1-9; its METARs and SPECIs rebroadcast every 5 minutes,
 * TBL 7-1-3), as a cockpit receiver passes it on in GDL 90's uplink
 * message (lib/gdl90, spec §3.3): the 432-byte UAT uplink
 * payload, read as RTCA DO-282B lays it out -- an 8-byte header saying
 * where the ground station is and whether application data follows, then
 * information frames, each a 9-bit length and a 4-bit type, type 0 a
 * FIS-B APDU (DO-358) -- and of the APDUs, the generic text product (413),
 * which carries the METARs, TAFs, winds aloft and PIREPs as DLAC text, six
 * bits a character, records split by a record separator. The open
 * decoders (dump978, Stratux) read it so; the graphical products (NEXRAD,
 * the AIRMET and NOTAM overlays) are left for later.
 */

/** DLAC's 64 characters (DO-358): 0 is ETX, 28 a tab that the next
 *  character counts the spaces of, 29 the record separator. */
const DLAC = "\x03ABCDEFGHIJKLMNOPQRSTUVWXYZ\x1A\t\x1E\n| !\"#$%&'()*+,-./0123456789:;<=>?";
const TAB = 28;

/** DLAC text, four characters in three bytes. */
export function dlac(bytes: Uint8Array): string {
  let out = "";
  let spaces = false;
  for (let i = 0; i * 6 + 6 <= bytes.length * 8; i++) {
    const bit = i * 6;
    const byte = bit >> 3, shift = bit & 7;
    const pair = (bytes[byte]! << 8) | (bytes[byte + 1] ?? 0);
    const ch = (pair >> (10 - shift)) & 0x3f;
    if (spaces) {
      out += " ".repeat(ch);
      spaces = false;
    } else if (ch === TAB) spaces = true;
    else out += DLAC[ch];
  }
  return out;
}

/** The generic text product's ID (DO-358). */
export const TEXT_PRODUCT = 413;

export interface Apdu {
  productId: number;
  /** The APDU's data, after its header and time. */
  data: Uint8Array;
}

/** An information frame's FIS-B APDU: its product and data; null for one
 *  segmented across frames (the S flag), which a text report is not. The
 *  A, G and P flags change nothing of the header's length, as the open
 *  decoders read it. */
export function apdu(frame: Uint8Array): Apdu | null {
  if (frame.length < 4) return null;
  const b = (i: number) => frame[i]!;
  const productId = ((b(0) & 0x1f) << 6) | (b(1) >> 2);
  const segmented = (b(1) & 0x02) !== 0;
  // The time's format: hours and minutes, with seconds, with the month
  // and day, or with both -- 4, 5, 5 or 6 bytes of header in all.
  const time = ((b(1) & 0x01) << 1) | (b(2) >> 7);
  const header = [4, 5, 5, 6][time]!;
  if (segmented || frame.length < header) return null;
  return { productId, data: frame.subarray(header) };
}

/** A UAT uplink payload's FIS-B APDUs, frame by frame. */
export function apdus(payload: Uint8Array): Apdu[] {
  // The header's application data valid bit (byte 6, 0x20): without it
  // no frames follow.
  if (payload.length < 8 || !(payload[6]! & 0x20)) return [];
  const out: Apdu[] = [];
  const data = payload.subarray(8);
  let at = 0;
  while (at + 2 <= data.length) {
    const length = (data[at]! << 1) | (data[at + 1]! >> 7);
    const type = data[at + 1]! & 0x0f;
    if (length === 0 && type === 0) break;
    if (at + 2 + length > data.length) break;
    if (type === 0) {
      const found = apdu(data.subarray(at + 2, at + 2 + length));
      if (found) out.push(found);
    }
    at += 2 + length;
  }
  return out;
}

/** A text report as broadcast: its kind ("METAR", "SPECI", "TAF",
 *  "TAF.AMD", "WINDS", "PIREP"), its station, its time (DDHHMMZ) and the
 *  whole record as sent. */
export interface TextReport {
  kind: string;
  station: string;
  time: string;
  text: string;
}

/** The text product's records, each a report. */
export function textReports(data: Uint8Array): TextReport[] {
  // The record separator and ETX, DLAC's own characters 29 and 0.
  const ends = new RegExp(`[${DLAC[29]}${DLAC[0]}]`);
  return dlac(data).split(ends).flatMap(record => {
    const text = record.replace(/\s+/g, " ").trim();
    const [kind, station, time] = text.split(" ");
    return kind && station && time && /^[A-Z.]+$/.test(kind) ? [{ kind, station, time, text }] : [];
  });
}

/** An uplink payload's text reports, from its generic text products. */
export function uplinkReports(payload: Uint8Array): TextReport[] {
  return apdus(payload).filter(a => a.productId === TEXT_PRODUCT).flatMap(a => textReports(a.data));
}
