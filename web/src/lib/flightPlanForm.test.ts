import { describe, expect, it } from "vitest";
import type { Leg, Totals } from "./api/types";
import {
  cruisingLevel, cruisingSpeed, flightPlanForms, formText, hhmmForm, personsOnBoard, routeItem, withPersonsOnBoard, type FormInput,
} from "./flightPlanForm";

const airway = (stop: string) => /^[VTJQ]\d{1,4}$/.test(stop);

function leg(from: string, to: string, altitudeFt: number, tasKt = 112.4, burn = 8.5): Leg {
  return {
    from, to, distance_nm: 20, altitude_ft: altitudeFt, true_course_deg: 0, wind: null, wca_deg: 0, true_heading_deg: 0,
    magnetic_variation_deg: 0, magnetic_heading_deg: 0, groundspeed_kt: tasKt, ete_min: 10, fuel_gal: 1.4,
    tas_kt: tasKt, fuel_burn_gph: burn, power_pct: 65, density_altitude_ft: altitudeFt, climb_min: 0,
  } as Leg;
}

function totals(eteMin: number, usable = 40, hops: Totals["hops"] = []): Totals {
  return { distance_nm: 100, ete_min: eteMin, fuel_gal: 9, unflyable_legs: 0, legs_without_wind: 0, usable_fuel_gal: usable, rules: "ifr", hops } as Totals;
}

const BASE: FormInput = {
  rules: "ifr", dep: "C81", dest: "KATW", route: ["BAE", "V191", "OSH"], landings: [], isAirway: airway,
  legs: [leg("C81", "BAE", 6000), leg("BAE", "CORIR", 6000), leg("CORIR", "OSH", 6000), leg("OSH", "KATW", 6000)],
  totals: totals(64.2), depart: new Date("2026-10-11T15:05:00Z"), now: new Date("2026-10-11T12:00:00Z"),
  aircraft: { ident: "N12345", type: "C172", maxTakeoffLb: 2550 }, fuelGal: 38, alternate: "KMSN",
};

const value = (form: { items: { key: string; value: string | null }[] }, key: string) => form.items.find(f => f.key === key)?.value;

describe("the FAA flight plan form, filled in from a plan", () => {
  it("writes each item as AIM Appendix 4 does", () => {
    expect(cruisingSpeed(112.4)).toBe("N0112");
    expect(cruisingLevel(6000)).toBe("A060");
    expect(cruisingLevel(10_500)).toBe("A105");
    // Flight levels from 18,000 ft (14 CFR 91.121(a)(2)).
    expect(cruisingLevel(17_999)).toBe("A180");
    expect(cruisingLevel(18_000)).toBe("F180");
    expect(hhmmForm(65)).toBe("0105");
    expect(hhmmForm(600)).toBe("1000");
    expect(hhmmForm(119.6)).toBe("0200");
  });

  it("an airway between the fixes it is joined and left at, DCT between fixes flown direct", () => {
    expect(routeItem(["BAE", "V191", "OSH"], airway)).toBe("BAE V191 OSH");
    expect(routeItem(["MDW", "V262", "BDF", "V10", "BRL", "STJ", "SLN"], airway)).toBe("MDW V262 BDF V10 BRL DCT STJ DCT SLN");
    expect(routeItem([], airway)).toBe("DCT");
  });

  it("a departure procedure first, left at its transition's fix, and an arrival last, joined at its own", () => {
    // AIM Appendix 4's own example.
    expect(routeItem(["EIC", "V18", "MEI"], airway, { id: "DALL3", transition: "EIC" }, { id: "LGC4", transition: "MEI" }))
      .toBe("DALL3 EIC V18 MEI LGC4");
    expect(routeItem(["XYZ"], airway, { id: "DALL3", transition: "EIC" }, null)).toBe("DALL3 EIC DCT XYZ");
    expect(routeItem([], airway, { id: "JANNY5", transition: null }, { id: "SADDE8", transition: "GMN" })).toBe("JANNY5 GMN SADDE8");
  });

  it("an IFR flight: the airplane, the time in UTC, the route, the EET, the alternate and the endurance", () => {
    const [form] = flightPlanForms(BASE);
    expect(form!.items.map(f => `${f.item} ${f.value}`)).toEqual([
      "8 IFR", "7 N12345", "9 C172/L", "10a null", "10b null", "13 C81", "13 1505", "15 N0112", "15 A060", "15 BAE V191 OSH",
      "16 KATW", "16 0105", "16 KMSN", "19 0428", "19 null", "19 null", "19 null",
    ]);
    // C81 has no four-letter indicator: ZZZZ and DEP/ where one is asked for.
    expect(form!.items.find(f => f.key === "departure")!.note).toContain("DEP/C81");
    expect(form!.items.find(f => f.key === "destination")!.note).toBeUndefined();
    expect(form!.items.find(f => f.key === "endurance")!.note).toBe("38 gal at 8.5 gph.");
  });

  it("a VFR flight: no alternate, and the date of flight where it is not today, in UTC", () => {
    const [form] = flightPlanForms({ ...BASE, rules: "vfr", route: [], depart: new Date("2026-10-12T01:30:00Z") });
    expect(value(form!, "rules")).toBe("VFR");
    expect(value(form!, "route")).toBe("DCT");
    expect(value(form!, "alternate")).toBeUndefined();
    // 01:30 UTC on the 12th, though the 11th in Chicago.
    expect(value(form!, "time")).toBe("0130");
    expect(value(form!, "other")).toBe("DOF/261012");
  });

  it("a plan that steps says where, and under IFR that ATC is asked", () => {
    const [form] = flightPlanForms({ ...BASE, legs: [leg("C81", "BAE", 6000), leg("BAE", "OSH", 8000), leg("OSH", "KATW", 8000)] });
    expect(value(form!, "level")).toBe("A060");
    expect(form!.items.find(f => f.key === "level")!.note).toBe("Then 8,000 ft from BAE, asked of ATC on the way.");
  });

  it("the procedures picked are filed under IFR alone, and said where they came from", () => {
    const picked = { departureProcedure: { id: "DALL3", transition: "BAE" }, arrivalProcedure: { id: "LGC4", transition: "OSH" } };
    const [form] = flightPlanForms({ ...BASE, ...picked });
    expect(value(form!, "route")).toBe("DALL3 BAE V191 OSH LGC4");
    expect(form!.items.find(f => f.key === "route")!.note).toBe("DALL3 and LGC4 as picked in the route's Procedures.");
    expect(value(flightPlanForms({ ...BASE, ...picked, rules: "vfr" })[0]!, "route")).toBe("BAE V191 OSH");
  });

  it("a T route says what it asks of the airplane", () => {
    const [form] = flightPlanForms({ ...BASE, route: ["BAE", "T246", "OSH"] });
    expect(form!.items.find(f => f.key === "route")!.note).toContain("PBN/C2");
    expect(flightPlanForms(BASE)[0]!.items.find(f => f.key === "route")!.note).toBeUndefined();
  });

  it("a route that lands on the way is a form a flight, each with its own EET, the alternate on the last", () => {
    const hops = [
      { departure: "C81", destination: "KOSH", totals: totals(50.5) },
      { departure: "KOSH", destination: "KATW", totals: totals(12, 53) },
    ];
    const forms = flightPlanForms({
      ...BASE, route: ["BAE", "KOSH", "OSH"], landings: ["KOSH"],
      legs: [leg("C81", "BAE", 6000), leg("BAE", "KOSH", 6000), leg("KOSH", "OSH", 3000, 100, 7), leg("OSH", "KATW", 3000, 100, 7)],
      totals: { ...totals(62.5), hops },
    });
    expect(forms.map(f => `${f.departure}-${f.destination}`)).toEqual(["C81-KOSH", "KOSH-KATW"]);
    expect(value(forms[0]!, "route")).toBe("BAE");
    expect(value(forms[0]!, "eet")).toBe("0051");
    expect(value(forms[0]!, "alternate")).toBeUndefined();
    expect(value(forms[1]!, "route")).toBe("OSH");
    expect(value(forms[1]!, "level")).toBe("A030");
    expect(value(forms[1]!, "speed")).toBe("N0100");
    expect(value(forms[1]!, "eet")).toBe("0012");
    expect(value(forms[1]!, "alternate")).toBe("KMSN");
    // When it leaves the stop is not known; the tanks are filled there.
    expect(value(forms[1]!, "time")).toBeNull();
    expect(value(forms[1]!, "endurance")).toBe("0734");
  });

  it("as Flight Service is sent it, where every item it needs is known", () => {
    const [form] = flightPlanForms(BASE);
    expect(form!.filing).toEqual({
      rules: "IFR", aircraftId: "N12345", aircraftType: "C172/L", departure: "C81", departureTime: "2026-10-11T15:05:00.000Z",
      cruisingSpeed: "N0112", cruisingLevel: "A060", route: "BAE V191 OSH", destination: "KATW", eetMinutes: 65,
      alternate: "KMSN", otherInformation: null, enduranceMinutes: 268, personsOnBoard: null,
    });
    // No registration (a stock profile), or no departure time: not to be filed.
    expect(flightPlanForms({ ...BASE, aircraft: { ...BASE.aircraft, ident: null } })[0]!.filing).toBeNull();
    expect(flightPlanForms({ ...BASE, depart: null })[0]!.filing).toBeNull();
  });

  it("what the plan cannot say is left blank: a stock profile's registration, a wake category not known", () => {
    const [form] = flightPlanForms({ ...BASE, aircraft: { ident: null, type: "P28A", maxTakeoffLb: null }, depart: null });
    expect(value(form!, "ident")).toBeNull();
    expect(value(form!, "type")).toBe("P28A");
    expect(value(form!, "time")).toBeNull();
    expect(formText(form!).split("\n").slice(0, 4)).toEqual([
      "C81 to KATW", "Item 8  Flight rules: IFR", "Item 7  Aircraft identification: —", "Item 9  Type of aircraft: P28A",
    ]);
    // A stock profile's equipment and colour are not known, and not the
    // pilot's to set anywhere: no word of where.
    expect(value(form!, "equipment")).toBeNull();
    expect(form!.items.find(f => f.key === "equipment")!.note).toBeUndefined();
  });

  it("item 10 from the pilot's own airplane: 10a's equipment and 10b's surveillance, as AIM Appendix 4 writes them", () => {
    const [form] = flightPlanForms({ ...BASE, aircraft: { ...BASE.aircraft, equipment: "SDFGRY", surveillance: "B1" } });
    expect(form!.items.filter(f => f.item.startsWith("10")).map(f => `${f.item} ${f.label}: ${f.value}`))
      .toEqual(["10a Equipment: SDFGRY", "10b Surveillance: B1"]);
    expect(form!.items.find(f => f.key === "equipment")!.note).toBeUndefined();
    // Not said for the pilot's own airplane: where to say it.
    expect(flightPlanForms(BASE)[0]!.items.find(f => f.key === "surveillance")!.note).toContain("Airplanes");
  });

  it("item 19's domestic minimum: endurance, persons on board, the pilot's name and number, the airplane's colour", () => {
    const [form] = flightPlanForms({
      ...BASE, aircraft: { ...BASE.aircraft, colour: "White blue stripes" },
      pilot: { name: "Avery B. Pilot", phone: "608-555-0100", homeBase: "KMSN" },
    });
    expect(form!.items.filter(f => f.item === "19").map(f => `${f.label}: ${f.value}`)).toEqual([
      "Endurance: 0428", "Persons on board: null", "Color and markings: White blue stripes",
      "Pilot in command: Avery B. Pilot, 608-555-0100, home base KMSN",
    ]);
    expect(form!.items.find(f => f.key === "pilot")!.note).toBeUndefined();
    // No number: the pilot is asked for one good at the ETA (AIM Appendix 4).
    const unreachable = flightPlanForms({ ...BASE, pilot: { name: "Avery B. Pilot", phone: null, homeBase: null } })[0]!;
    expect(value(unreachable, "pilot")).toBe("Avery B. Pilot");
    expect(unreachable.items.find(f => f.key === "pilot")!.note).toContain("phone number");
    expect(value(flightPlanForms(BASE)[0]!, "pilot")).toBeNull();
  });

  it("the persons on board, typed for the flight, go on the form and to Flight Service", () => {
    expect(personsOnBoard("2")).toBe(2);
    expect(personsOnBoard(" 12 ")).toBe(12);
    for (const typed of ["", "0", "1000", "two", "2.5", "-1"]) expect(personsOnBoard(typed)).toBeNull();
    const [form] = flightPlanForms(BASE);
    const filled = withPersonsOnBoard(form!, 3);
    expect(value(filled, "persons")).toBe("3");
    expect(filled.filing!.personsOnBoard).toBe(3);
    expect(formText(filled)).toContain("Item 19  Persons on board: 3");
    // Left blank, blank on both.
    const blank = withPersonsOnBoard(form!, null);
    expect(value(blank, "persons")).toBeNull();
    expect(blank.filing!.personsOnBoard).toBeNull();
    expect(formText(blank)).toContain("Item 19  Persons on board: —");
  });
});
