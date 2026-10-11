import { describe, expect, it } from "vitest";
import { apdu, dlac, uplinkReports, TEXT_PRODUCT } from "./fisb";
import { apduOf, toDlac, uplink } from "./fisbFixtures";
import { frame, read } from "./gdl90";

const METAR = "METAR KDLH 111555Z 25012KT 10SM BKN090 13/M02 A3012 RMK AO2=";
const TAF = "TAF KDLH 111130Z 1112/1212 25012KT P6SM SCT050\n     FM111800 27015G25KT P6SM BKN040";

describe("FIS-B", () => {
  it("reads DLAC, a tab its count of spaces", () => {
    expect(dlac(toDlac("METAR KDLH"))).toBe("METAR KDLH");
    // A tab (28), then C (3): three spaces.
    expect(dlac(toDlac("A\tCB"))).toBe("A   B");
  });

  it("finds the text product's reports in an uplink, as a receiver passes it on in GDL 90", () => {
    const text = apduOf(TEXT_PRODUCT, toDlac(`${METAR}\x1e${TAF}\x1e\x03`));
    // A graphical product beside it, left alone.
    const nexrad = apduOf(63, Uint8Array.from([1, 2, 3, 4, 5]));
    const payload = uplink(nexrad, text);
    const datagram = frame(Uint8Array.from([0x07, 0x12, 0x34, 0x56, ...payload]));
    const [message] = read(datagram);
    expect(message?.kind).toBe("uplink");
    const reports = uplinkReports(message!.kind === "uplink" ? message!.payload : new Uint8Array());
    expect(reports.map(r => [r.kind, r.station, r.time])).toEqual([["METAR", "KDLH", "111555Z"], ["TAF", "KDLH", "111130Z"]]);
    expect(reports[0]!.text).toBe(METAR);
    // The TAF's lines run together, one space between its words.
    expect(reports[1]!.text).toBe("TAF KDLH 111130Z 1112/1212 25012KT P6SM SCT050 FM111800 27015G25KT P6SM BKN040");
  });

  it("leaves out an APDU segmented across frames, and an uplink with no application data", () => {
    expect(apdu(apduOf(TEXT_PRODUCT, toDlac(METAR), true))).toBeNull();
    const payload = uplink(apduOf(TEXT_PRODUCT, toDlac(METAR)));
    payload[6] = 0;
    expect(uplinkReports(payload)).toEqual([]);
  });
});
