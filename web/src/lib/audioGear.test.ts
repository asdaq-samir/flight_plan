import { describe, expect, it } from "vitest";
import { GEAR, gearFor, hearing } from "./audioGear";

describe("gearFor", () => {
  // The names each maker's manual says the phone lists, "#" made digits.
  it.each([
    ["Bose A20", "bose-a20"],
    ["Bose A30", "bose-a30"],
    ["DC ONE-X", "dc-one-x"],
    ["DC PRO-X2", "dc-pro-x2"],
    ["Delta Zulu_4821", "lightspeed-delta-zulu"],
    ["Zulu 4_30512", "lightspeed-zulu-4"],
    ["Zulu PFX 1187", "lightspeed-zulu-pfx"],
    ["Lightspeed-V102", "lightspeed-zulu-3-sierra-tango"],
    ["PMA8000G", "pse-pma8000g"],
    ["PMA8000BT", "pse-pma8000bt"],
    ["PAR200B", "pse-par200b"],
    ["PMA450A", "pse-pma450a"],
    ["PMA450", "pse-pma450"],
    ["PAR200A", "pse-par200a"],
    ["BT2 2849", "pse-ps-streamer"],
    ["BT1 2849", "pse-pma450b"],
    ["AMX240", "avidyne-amx240"],
    ["Sam's AirPods Pro", "apple-airpods"],
    ["PFX 1187", "lightspeed-zulu-pfx"],
    ["GMA Bluetooth", "garmin-gma-35c"],
    ["Bose ProFlight", "bose-proflight-2"],
    ["DC PRO-X", "dc-pro-x"],
  ])("knows %s as its maker names it", (label, id) => {
    expect(gearFor(label)?.id).toBe(id);
  });

  // Garmin documents no Bluetooth name, so its panels go by model number,
  // however the label spaces it.
  it.each([
    ["GMA 350c", "garmin-gma-350c"],
    ["GMA350c", "garmin-gma-350c"],
    ["Garmin GMA-350c", "garmin-gma-350c"],
    ["GMA 350Hc", "garmin-gma-350hc"],
    ["GMA 345", "garmin-gma-345"],
    ["GMA 35c", "garmin-gma-35c"],
    ["GMA350c_1234", "garmin-gma-350c"],
    ["GMA350c1234", "garmin-gma-350c"],
    ["GMA 245R", "garmin-gma-245r"],
    ["GMA 245", "garmin-gma-245"],
    ["GMA 1360D", "garmin-gma-1360"],
    ["Zulu 3", "lightspeed-zulu-3-sierra-tango"],
    ["Lightspeed Sierra", "lightspeed-zulu-3-sierra-tango"],
    ["Lightspeed Tango", "lightspeed-zulu-3-sierra-tango"],
    ["Zulu.2", "lightspeed-zulu-3-sierra-tango"],
    ["Zulu H-Mod", "lightspeed-zulu-3-sierra-tango"],
    ["DC ONE-XP", "dc-one-x"],
    ["DC ONE-XH", "dc-one-x"],
  ])("knows %s by its model", (label, id) => {
    expect(gearFor(label)?.id).toBe(id);
  });

  // PS Engineering's modules: BT1 and BT2 and four serial digits, spaced
  // or not; "PMA450B BT 2" and four (PMA450B IM §3.11.1.2); "450A BT2" and
  // "PMA450BT2" on a PMA450A (its PG p.12).
  it.each([
    ["BT2 2849", "pse-ps-streamer"],
    ["BT 2 2849", "pse-ps-streamer"],
    ["BT2-2849", "pse-ps-streamer"],
    ["BT22849", "pse-ps-streamer"],
    ["PMA450B BT 2 2849", "pse-ps-streamer"],
    ["450A BT2", "pse-ps-streamer"],
    ["PMA450BT2", "pse-ps-streamer"],
    ["BT2 2849 (Bluetooth)", "pse-ps-streamer"],
    ["BT 1 2849", "pse-pma450b"],
    ["BT12849", "pse-pma450b"],
    ["BT1-2849", "pse-pma450b"],
    ["BT1_2849", "pse-pma450b"],
    ["450A BT1", "pse-pma450a"],
    ["PMA450BT1", "pse-pma450a"],
    ["PMA450C BT 2 2849", "pse-pma450c"],
  ])("knows PS Engineering's %s", (label, id) => {
    expect(gearFor(label)?.id).toBe(id);
  });

  it("reads Chrome's labels, case and all", () => {
    expect(gearFor("Default - GMA 350c (Bluetooth)")?.id).toBe("garmin-gma-350c");
    expect(gearFor("Default - BT2 2849 (Bluetooth)")?.id).toBe("pse-ps-streamer");
    expect(gearFor("bose a30")?.id).toBe("bose-a30");
  });

  it.each([
    ["GMA 350Hc", "garmin-gma-350c"],
    ["GMA 35c", "garmin-gma-350c"],
    ["GMA 350c", "garmin-gma-35c"],
    ["Delta Zulu_3456", "lightspeed-zulu-3-sierra-tango"],
    ["Zulu 3", "lightspeed-delta-zulu"],
    ["Zulu 4_31234", "lightspeed-zulu-3-sierra-tango"],
    ["PMA8000BT", "pse-pma8000g"],
    ["PMA8000G", "pse-pma8000g-streamer"],
    ["PMA450B BT 2 2849", "pse-pma450b"],
    ["PMA450B", "pse-pma450"],
    ["GMA 245R", "garmin-gma-245"],
    ["DC PRO-X2", "dc-one-x"],
    ["DC PRO-X2", "dc-pro-x"],
    ["Bose A20", "bose-a30"],
  ])("does not take %s for %s", (label, id) => {
    expect(gearFor(label)?.id).not.toBe(id);
  });

  it.each([
    "GMA 350", // no Bluetooth
    "GMA 342",
    "GMA 340",
    "PMA8000B",
    "GMC Sierra", // a truck's hands-free, not a Lightspeed
    "Tango",
    "BT21 speaker",
    "BT10",
    "BT1000",
    "BT2000",
    "Zulu 32",
    "iPhone Microphone",
    "Bluetooth headset",
    "",
  ])("names nothing for %j", label => {
    expect(gearFor(label)).toBeNull();
  });

  it("names nothing without a label", () => {
    expect(gearFor(null)).toBeNull();
    expect(gearFor(undefined)).toBeNull();
  });

  it("knows every name a maker documents", () => {
    for (const g of GEAR.filter(g => g.shows)) {
      for (const shown of g.shows!.split(" or ")) {
        expect(gearFor(shown.replace(/#/g, "7")), `${g.id}: ${shown}`).not.toBeNull();
      }
    }
  });
});

describe("hearing", () => {
  it("hears the radio only through gear documented to send it", () => {
    expect(hearing("GMA 350c")).toBe("radio");
    expect(hearing("GMA 350Hc")).toBe("radio");
    expect(hearing("GMA 345")).toBe("unknown");
    expect(hearing("BT2 2849")).toBe("unknown");
    expect(hearing("PMA450B BT 2 2849")).toBe("unknown");
    expect(hearing("Delta Zulu_4821")).toBe("unknown");
  });

  it("hears voices through headsets and phone links", () => {
    expect(hearing("Bose A30")).toBe("voice");
    expect(hearing("Lightspeed-V102")).toBe("voice");
    expect(hearing("BT1 2849")).toBe("voice");
    expect(hearing("PMA8000G")).toBe("voice");
    expect(hearing("Sam's AirPods")).toBe("voice");
  });

  it("knows the device's own microphone", () => {
    expect(hearing("iPhone Microphone")).toBe("phone-mic");
    expect(hearing("iPad Microphone")).toBe("phone-mic");
    expect(hearing("MacBook Pro Microphone")).toBe("phone-mic");
    expect(hearing("Default - MacBook Air Microphone (Built-in)")).toBe("phone-mic");
    expect(hearing("Speakerphone")).toBe("phone-mic");
  });

  it("takes no label for the phone's microphone", () => {
    expect(hearing(null)).toBe("phone-mic");
    expect(hearing(undefined)).toBe("phone-mic");
    expect(hearing("")).toBe("phone-mic");
  });

  it("calls an outside input it can't name unknown, never the radio", () => {
    expect(hearing("Bluetooth headset")).toBe("unknown");
    expect(hearing("Headset Microphone")).toBe("unknown");
    expect(hearing("USB audio")).toBe("unknown");
    expect(hearing("BT 4521")).toBe("unknown");
  });
});

describe("the catalogue", () => {
  it("has a unique id for each entry", () => {
    expect(new Set(GEAR.map(g => g.id)).size).toBe(GEAR.length);
  });

  it("gives every entry steps, a line and a source", () => {
    for (const g of GEAR) {
      expect(g.steps.length, g.id).toBeGreaterThan(0);
      for (const step of g.steps) expect(step, g.id).toMatch(/^[A-Z].*\.$/);
      expect(g.says, g.id).toMatch(/^\S.*\.$/);
      expect(g.sources.length, g.id).toBeGreaterThan(0);
      for (const source of g.sources) expect(source, g.id).toMatch(/^https:\/\/\S+ \(.+seen 2026-11-04\)$/);
    }
  });

  it("never says the radio comes in unless it does", () => {
    for (const g of GEAR) {
      expect(/the radio comes in/.test(g.says), g.id).toBe(g.gives === "radio");
    }
    for (const g of GEAR.filter(g => g.gives === "voice")) {
      expect(g.says, g.id).toMatch(/not the radio/);
      expect(g.steps.join(" "), g.id).not.toMatch(/the radio comes in/);
    }
  });

  it("recognises what can be a Bluetooth input, and nothing else", () => {
    for (const g of GEAR) {
      const bluetooth = g.kind !== "cable" && g.gives !== "none";
      expect(g.names.length > 0, g.id).toBe(bluetooth);
      for (const re of g.names) expect(re.flags, `${g.id} ${re}`).toContain("i");
    }
  });

  it("documents every entry that claims the radio", () => {
    for (const g of GEAR.filter(g => g.kind !== "cable" && g.gives === "radio")) {
      expect(g.confidence, g.id).toBe("documented");
    }
  });

  it("has the phone's cellular radio off in the air, and no phone call", () => {
    const steps = GEAR.find(g => g.id === "garmin-gma-350c")!.steps;
    expect(steps).toContain("Turn on airplane mode, then turn Bluetooth back on: the phone's cellular radio must stay off in the air.");
    expect(steps.some(s => /phone call/.test(s))).toBe(true);
  });
});
