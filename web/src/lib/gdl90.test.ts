import { describe, expect, it } from "vitest";
import { crc16, frame, messages, read, report } from "./gdl90";

/** Hex bytes, spaces between. */
const bytes = (hex: string) => Uint8Array.from(hex.trim().split(/\s+/).map(h => parseInt(h, 16)));

/** The traffic report the GDL 90 specification gives as its example
 *  (560-1058-00 Rev A, §3.5.4): N825V, 44.90707 N 122.99486 W, 5,000 ft,
 *  airborne on a true track of 45 degrees at 123 kt, climbing 64 fpm. */
const SPEC_TRAFFIC = bytes("14 00 AB 45 49 1F EF 15 A8 89 78 0F 09 A9 07 B0 01 20 01 4E 38 32 35 56 20 20 20 00");

describe("gdl90", () => {
  it("checks the specification's example heartbeat by its CRC", () => {
    // §2.2.3's example: 7E 00 81 41 DB D0 08 02 B3 8B 7E, CRC 0x8BB3 sent low byte first.
    const datagram = bytes("7E 00 81 41 DB D0 08 02 B3 8B 7E");
    expect(crc16(bytes("00 81 41 DB D0 08 02"))).toBe(0x8bb3);
    expect(read(datagram)).toEqual([{ kind: "heartbeat", gpsValid: true }]);
    // One byte wrong: the CRC fails and the message is left out.
    expect(read(bytes("7E 00 81 41 DB D0 08 03 B3 8B 7E"))).toEqual([]);
  });

  it("reads the specification's example traffic report", () => {
    const traffic = report(SPEC_TRAFFIC)!;
    expect(traffic.hex).toBe("ab4549");
    expect(traffic.lat).toBeCloseTo(44.90707, 5);
    expect(traffic.lon).toBeCloseTo(-122.99486, 5);
    expect(traffic.altitudeFt).toBe(5000);
    expect(traffic.airborne).toBe(true);
    expect(traffic.speedKt).toBe(123);
    expect(traffic.verticalFpm).toBe(64);
    expect(traffic.trackDeg).toBe(45);
    expect(traffic.callsign).toBe("N825V");
    expect(traffic.emergency).toBeNull();
    expect(traffic.positioned).toBe(true);
  });

  it("unframes and unescapes a datagram of several messages, a flag and an escape inside one", () => {
    // A callsign with the flag and the escape in it, escaped as sent.
    const awkward = Uint8Array.from(SPEC_TRAFFIC);
    awkward[19] = 0x7e;
    awkward[20] = 0x7d;
    const datagram = Uint8Array.from([...frame(bytes("00 81 41 DB D0 08 02")), ...frame(awkward)]);
    expect(datagram.filter(b => b === 0x7d).length).toBeGreaterThanOrEqual(2);
    const bodies = messages(datagram);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(awkward);
  });

  it("marks an address that names no airframe, and says what is unavailable", () => {
    const body = Uint8Array.from(SPEC_TRAFFIC);
    body[1] = 0x01;                       // ADS-B, self-assigned address
    body[11] = 0xff; body[12] = 0xf0;     // altitude invalid, on the ground, track invalid
    body[14] = 0xff; body[15] = 0xf8; body[16] = 0x00;   // speed and vertical rate unavailable
    body[27] = 0x50;                      // unlawful interference
    const traffic = report(body)!;
    expect(traffic.hex).toBe("~ab4549");
    expect(traffic.altitudeFt).toBeNull();
    expect(traffic.airborne).toBe(false);
    expect(traffic.trackDeg).toBeNull();
    expect(traffic.speedKt).toBeNull();
    expect(traffic.verticalFpm).toBeNull();
    expect(traffic.emergency).toBe("unlawful");
  });

  it("reads own ship's report and its geometric altitude", () => {
    const own = Uint8Array.from(SPEC_TRAFFIC);
    own[0] = 0x0a;
    // 0x0B: 1,000 ft as 200 units of 5 ft, then the vertical figure of merit.
    const datagram = Uint8Array.from([...frame(own), ...frame(bytes("0B 00 C8 00 0A"))]);
    expect(read(datagram).map(m => m.kind)).toEqual(["ownship", "ownship-altitude"]);
    expect(read(datagram)[1]).toEqual({ kind: "ownship-altitude", geometricFt: 1000 });
  });
});
