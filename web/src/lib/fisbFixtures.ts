/** FIS-B as a ground station sends it, made for the tests (lib/fisb,
 *  lib/map/receiver): DLAC text, an APDU, a UAT uplink payload. */

const ALPHABET = "\x03ABCDEFGHIJKLMNOPQRSTUVWXYZ\x1A\t\x1E\n| !\"#$%&'()*+,-./0123456789:;<=>?";

/** Text as DLAC, six bits a character, as a ground station sends it. */
export function toDlac(text: string): Uint8Array {
  const codes = [...text].map(c => {
    const code = ALPHABET.indexOf(c);
    if (code < 0) throw new Error(`not DLAC: ${JSON.stringify(c)}`);
    return code;
  });
  const out = new Uint8Array(Math.ceil((codes.length * 6) / 8));
  codes.forEach((code, i) => {
    for (let bit = 0; bit < 6; bit++) {
      if (code & (0x20 >> bit)) {
        const at = i * 6 + bit;
        out[at >> 3]! |= 0x80 >> (at & 7);
      }
    }
  });
  return out;
}

/** A FIS-B APDU of a product, its time hours and minutes (DO-358). */
export function apduOf(product: number, data: Uint8Array, segmented = false): Uint8Array {
  const [hours, minutes] = [15, 55];
  return Uint8Array.from([
    (product >> 6) & 0x1f,
    ((product & 0x3f) << 2) | (segmented ? 0x02 : 0),
    (hours << 2) | (minutes >> 4),
    (minutes & 0x0f) << 4,
    ...data,
  ]);
}

/** A UAT uplink payload of these APDUs, each a type 0 information frame
 *  (DO-282B), its header saying application data follows. */
export function uplink(...apdus: Uint8Array[]): Uint8Array {
  const payload = new Uint8Array(432);
  payload[6] = 0x20;
  let at = 8;
  for (const a of apdus) {
    payload[at] = a.length >> 1;
    payload[at + 1] = (a.length & 1) << 7;
    payload.set(a, at + 2);
    at += 2 + a.length;
  }
  return payload;
}
