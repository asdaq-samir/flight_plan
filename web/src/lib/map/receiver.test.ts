import { afterEach, describe, expect, it } from "vitest";
import { frame } from "../gdl90";
import { ingest, useReceiver } from "./receiver";
import { mergeTraffic } from "./traffic";
import type { Report } from "./tracking";

/** The GDL 90 specification's example traffic report (§3.5.4): N825V,
 *  address AB4549, 5,000 ft pressure altitude, airborne. */
const N825V = Uint8Array.from("14 00 AB 45 49 1F EF 15 A8 89 78 0F 09 A9 07 B0 01 20 01 4E 38 32 35 56 20 20 20 00".split(" ").map(h => parseInt(h, 16)));

/** The same report as own ship's (message 10), at address `hex`. */
function ownship(hex: number, pressureFt: number) {
  const body = Uint8Array.from(N825V);
  body[0] = 0x0a;
  body[2] = hex >> 16; body[3] = (hex >> 8) & 0xff; body[4] = hex & 0xff;
  const altitude = (pressureFt + 1000) / 25;
  body[11] = altitude >> 4; body[12] = ((altitude & 0x0f) << 4) | (body[12]! & 0x0f);
  return body;
}

/** Own ship's geometric height (message 11), feet. */
const geometric = (feet: number) => Uint8Array.from([0x0b, (feet / 5) >> 8, (feet / 5) & 0xff, 0x00, 0x0a]);

describe("a cockpit receiver", () => {
  afterEach(() => useReceiver.setState({ traffic: {}, ownHex: null, ownPressureFt: null, ownGeometricFt: null, connected: false, heardAt: null }));

  it("hears traffic, its height a pressure altitude until own ship's two heights give the difference", () => {
    ingest(frame(N825V), 1000);
    let plane = useReceiver.getState().traffic.ab4549!.plane;
    expect(plane.altitude_ft).toBe(5000);
    expect(plane.pressure_altitude).toBe(true);
    expect(useReceiver.getState().connected).toBe(true);
    // Own ship at 3,000 ft pressure, 3,150 ft geometric: the day's 150 ft
    // between them added to the traffic's.
    ingest(Uint8Array.from([...frame(ownship(0xa00001, 3000)), ...frame(geometric(3150)), ...frame(N825V)]), 2000);
    plane = useReceiver.getState().traffic.ab4549!.plane;
    expect(plane.altitude_ft).toBe(5150);
    expect(plane.pressure_altitude).toBe(false);
    expect(plane.callsign).toBe("N825V");
  });

  it("leaves out own ship's own echo and an airplane on the ground", () => {
    const onGround = Uint8Array.from(N825V);
    onGround[12] = 0x01;
    onGround[4] = 0x50;
    ingest(Uint8Array.from([...frame(ownship(0xab4549, 3000)), ...frame(N825V), ...frame(onGround)]), 1000);
    expect(Object.keys(useReceiver.getState().traffic)).toEqual([]);
  });

  it("merges with the internet's by address, the fresher report keeping the internet's registration", () => {
    const internet: Report[] = [
      { plane: { hex: "ab4549", callsign: "N825V", registration: "N825V", type: "C182", lat: 44.9, lon: -123, pressure_altitude: false, altitude_ft: 5100 }, at: 1000 },
      { plane: { hex: "a00002", callsign: "UAL1", registration: "N1", type: "A320", lat: 45, lon: -123, pressure_altitude: false }, at: 1000 },
    ];
    const cockpit: Report[] = [
      { plane: { hex: "ab4549", callsign: null, registration: null, type: null, lat: 44.91, lon: -122.99, pressure_altitude: false, altitude_ft: 5150 }, at: 1500 },
    ];
    const merged = mergeTraffic(internet, cockpit, "a00002")!;
    expect(merged).toHaveLength(1);
    expect(merged[0]!.plane).toMatchObject({ hex: "ab4549", callsign: "N825V", registration: "N825V", type: "C182", altitude_ft: 5150, lat: 44.91 });
    expect(merged[0]!.at).toBe(1500);
    // An older receiver report gives way to the internet's fresher one.
    expect(mergeTraffic(internet, [{ ...cockpit[0]!, at: 500 }], null)!.find(r => r.plane.hex === "ab4549")!.plane.altitude_ft).toBe(5100);
    expect(mergeTraffic(null, [], null)).toBeNull();
  });
});
