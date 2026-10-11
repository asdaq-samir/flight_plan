import { describe, expect, it } from "vitest";
import type { Leg, Totals } from "./api/types";
import { cruisingLevel, cruisingSpeed, flightPlanForms, formText, hoursMinutes, routeItem, type FormInput } from "./flightPlanForm";

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
    expect(hoursMinutes(65)).toBe("0105");
    expect(hoursMinutes(600)).toBe("1000");
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
      "8 IFR", "7 N12345", "9 C172/L", "13 C81", "13 1505", "15 N0112", "15 A060", "15 BAE V191 OSH",
      "16 KATW", "16 0105", "16 KMSN", "19 0428",
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

  it("what the plan cannot say is left blank: a stock profile's registration, a wake category not known", () => {
    const [form] = flightPlanForms({ ...BASE, aircraft: { ident: null, type: "P28A", maxTakeoffLb: null }, depart: null });
    expect(value(form!, "ident")).toBeNull();
    expect(value(form!, "type")).toBe("P28A");
    expect(value(form!, "time")).toBeNull();
    expect(formText(form!).split("\n").slice(0, 4)).toEqual(["C81 to KATW", "8 Flight rules: IFR", "7 Aircraft identification: —", "9 Type of aircraft: P28A"]);
  });
});
