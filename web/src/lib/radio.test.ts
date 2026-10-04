import { describe, expect, test } from "vitest";
import type { Briefing, Leg } from "./api/types";
import { compassWord, entryFor, exitFor, runwayInUse, type RunwayEnd } from "./pattern";
import { callSign, placeName, radioScript, spokenAltitude, spokenRunway, spokenTail } from "./radio";

type Facilities = Briefing["airports"][string];

const end = (ident: string, heading: number, traffic: "left" | "right" = "left"): RunwayEnd => ({ ident, heading_true_deg: heading, traffic });

const WAUKEGAN: Facilities = {
  name: "Waukegan National Airport", elevation_ft: 727, airspace_class: "D",
  pattern: { agl_ft: 1000, altitude_ft: 1727, published: false },
  runways: [
    { ends: "05/23", length_ft: 6000, width_ft: 150, surface: "ASP", lighted: true, closed: false,
      wind: { end: "23", headwind_kt: 8, crosswind_kt: 3 }, runway_ends: [end("05", 48), end("23", 228, "right")] },
    { ends: "14/32", length_ft: 3750, width_ft: 100, surface: "ASP", lighted: true, closed: false,
      wind: { end: "32", headwind_kt: 4, crosswind_kt: -1 }, runway_ends: [end("14", 144), end("32", 324)] },
  ],
  frequencies: [
    { type: "ATIS", description: "ATIS", frequency_mhz: 132.4 },
    { type: "A/D", description: "CHICAGO APP/DEP", frequency_mhz: 120.55 },
    { type: "GND", description: "GND", frequency_mhz: 121.65 },
    { type: "TWR", description: "TWR", frequency_mhz: 120.05 },
    { type: "CTAF", description: "CTAF", frequency_mhz: 120.05 },
  ],
};

const DACY: Facilities = {
  name: "Dacy Airport", elevation_ft: 913, airspace_class: "G",
  pattern: { agl_ft: 1000, altitude_ft: 1913, published: false },
  runways: [
    { ends: "09/27", length_ft: 3270, width_ft: 40, surface: "ASP", lighted: true, closed: false,
      wind: { end: "27", headwind_kt: 6, crosswind_kt: 2 }, runway_ends: [end("09", 90), end("27", 270)] },
  ],
  frequencies: [
    { type: "A/D", description: "CHICAGO APP/DEP", frequency_mhz: 120.55 },
    { type: "UNIC", description: "CTAF/UNICOM", frequency_mhz: 122.7 },
  ],
};

const leg = (from: string, to: string, course: number, altitude = 5500): Leg => ({ from, to, true_course_deg: course, altitude_ft: altitude } as Leg);

describe("spoken as the AIM speaks it", () => {
  test("registrations, altitudes and runways", () => {
    expect(spokenTail("N345SP")).toBe("Three Four Five Sierra Papa");
    expect(spokenTail("n19")).toBe("One Niner");
    expect(callSign("Cessna", "N345SP")).toBe("Cessna Three Four Five Sierra Papa");
    expect(callSign("Piper", null)).toBe("Piper [your registration]");
    expect(spokenAltitude(3500)).toBe("three thousand five hundred");
    expect(spokenAltitude(10500)).toBe("one zero thousand five hundred");
    expect(spokenAltitude(2000)).toBe("two thousand");
    expect(spokenAltitude(800)).toBe("eight hundred");
    expect(spokenRunway("27")).toBe("two seven");
    expect(spokenRunway("09L")).toBe("niner left");
    expect(spokenRunway("06")).toBe("six");
    expect(placeName("Waukegan National Airport", "KUGN")).toBe("Waukegan");
    expect(placeName("Lake In The Hills Airport", "3CK")).toBe("Lake In The Hills");
    expect(placeName(null, "C81")).toBe("C81");
  });
});

describe("the pattern", () => {
  test("the runway in use is the most headwind's, else the longest's", () => {
    expect(runwayInUse(WAUKEGAN.runways)).toMatchObject({ end: { ident: "23", traffic: "right" }, byWind: true });
    const calm = WAUKEGAN.runways.map(r => ({ ...r, wind: null }));
    expect(runwayInUse(calm)).toMatchObject({ end: { ident: "05" }, byWind: false });
    expect(runwayInUse([])).toBeNull();
  });

  test("the 45 from the pattern's side, over midfield from the other", () => {
    // Right traffic for 23 (heading 228): the downwind is to the
    // northwest of the runway, at 318.
    const right23 = end("23", 228, "right");
    const fromNorthwest = entryFor(right23, 135);
    expect(fromNorthwest).toMatchObject({ from: "northwest", patternSide: true });
    expect(fromNorthwest.words).toContain("join the 45° to the right downwind for runway 23");
    const fromSoutheast = entryFor(right23, 315);
    expect(fromSoutheast).toMatchObject({ from: "southeast", patternSide: false });
    expect(fromSoutheast.words).toContain("cross midfield 500 ft above pattern altitude");
    expect(exitFor(end("27", 270))).toContain("45° left turn");
    expect(compassWord(-90)).toBe("west");
  });
});

describe("the radio calls", () => {
  const script = radioScript({
    callSign: "Cessna Three Four Five Sierra Papa",
    airports: [{ ident: "C81", facilities: DACY }, { ident: "KUGN", facilities: WAUKEGAN }],
    legs: [leg("C81", "Lake", 45), leg("Lake", "KUGN", 45, 3500)],
  });

  test("leaving a field with no tower is the CTAF's self-announcing, the field named first and last", () => {
    const leaving = script[0]!;
    expect(leaving).toMatchObject({ title: "Leaving C81", kind: "departure", end: { ident: "27" } });
    expect(leaving.calls[0]).toMatchObject({ to: "Dacy traffic", mhz: 122.7 });
    expect(leaving.calls[0]!.words).toBe("Dacy traffic, Cessna Three Four Five Sierra Papa, taxiing to runway two seven, Dacy.");
    expect(leaving.calls[1]!.words).toContain("departing the pattern to the northeast, climbing to five thousand five hundred, Dacy.");
    expect(leaving.calls.at(-1)!.words).toContain("request flight following to Waukegan");
    expect(leaving.calls.at(-2)).toMatchObject({ to: "Chicago Departure" });
  });

  test("into a Class D is the ATIS, then the tower before the Class D, then ground", () => {
    const into = script[1]!;
    expect(into).toMatchObject({ title: "Into KUGN", kind: "arrival", end: { ident: "23", traffic: "right" } });
    expect(into.calls[0]).toMatchObject({ to: "Waukegan ATIS", listen: true });
    // Ten miles out on a 3:1 descent to the 1,727 ft pattern: 5,100 ft,
    // but no higher than the 3,500 ft cruise.
    expect(into.calls[1]!.words).toBe("Waukegan Tower, Cessna Three Four Five Sierra Papa, ten miles southwest, three thousand five hundred, with information [letter], landing.");
    expect(into.calls[1]!.note).toContain("self-announce on the CTAF, 120.05");
    expect(into.calls[2]!.words).toContain("clear of runway two three");
  });

  test("into a field with no tower is the pattern called leg by leg on its side", () => {
    const [, , , back] = radioScript({
      callSign: "Cessna Three Four Five Sierra Papa",
      airports: [{ ident: "C81", facilities: DACY }, { ident: "KUGN", facilities: WAUKEGAN }, { ident: "C81", facilities: DACY }],
      legs: [leg("C81", "KUGN", 45, 3500), leg("KUGN", "Lake", 225), leg("Lake", "C81", 225, 4500)],
    });
    expect(back!.title).toBe("Into C81");
    const words = back!.calls.map(c => c.words);
    // 1,913 + 3,333 = 5,246, about 5,200, under the 4,500 cruise: 4,500.
    expect(words[0]).toBe("Dacy traffic, Cessna Three Four Five Sierra Papa, ten miles northeast, four thousand five hundred, inbound for landing, Dacy.");
    expect(words).toContain("Dacy traffic, Cessna Three Four Five Sierra Papa, left downwind runway two seven, Dacy.");
    expect(words.at(-1)).toBe("Dacy traffic, Cessna Three Four Five Sierra Papa, clear of runway two seven, Dacy.");
  });
});
