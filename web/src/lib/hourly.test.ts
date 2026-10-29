import { describe, expect, it } from "vitest";
import type { Metar } from "./api/types";
import { zuluTime } from "./clock";
import { arrivalHour, hoursOf, sentenceOf, tafOf } from "./hourly";

// 18:20Z on the 29th: the TAFs below were issued at 17:20 for 18Z on.
const NOW = Date.parse("2026-10-29T18:20:00Z");
const at = (iso: string) => Date.parse(iso);
// Zulu in the tests, so they read the same in any time zone; the card
// writes the device's clock.
const zulu = (ms: number) => zuluTime(new Date(ms));

const VFR_METAR: Metar = {
  raw: "KDLH 291753Z 27010KT 10SM FEW050 12/04 A3001", observed_at: "2026-10-29T17:53:00Z", flight_category: "VFR",
  ceiling_ft: null, visibility_sm: 10, wind_dir_true_deg: 270, wind_speed_kt: 10, wind_gust_kt: null,
  altimeter_in_hg: 30.01, temp_c: 12, dewpoint_c: 4,
};

const series = (raw: string | null, metar: Metar | null = VFR_METAR) => hoursOf({ metar, taf: tafOf(raw, NOW), now: NOW });

describe("a field's weather hour by hour", () => {
  it("Now is the METAR's, then each whole hour the TAF covers, an FM group prevailing until the next", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27012KT P6SM SCT050 FM292100 29015G22KT 5SM -RA BKN025 FM300100 31010KT P6SM SCT040");
    expect(hours[0]).toMatchObject({ now: true, at: at("2026-10-29T17:53:00Z"), category: "VFR", ceilingFt: null, sky: "partly", windSpeedKt: 10 });
    // 19Z on the 29th to 17Z on the 30th: the TAF ends at 18Z.
    expect(hours.slice(1).map(h => h.at)[0]).toBe(at("2026-10-29T19:00:00Z"));
    expect(hours.at(-1)!.at).toBe(at("2026-10-30T17:00:00Z"));
    expect(hours).toHaveLength(1 + 23);
    const byTime = (iso: string) => hours.find(h => !h.now && h.at === at(iso))!;
    expect(byTime("2026-10-29T20:00:00Z")).toMatchObject({ category: "VFR", ceilingFt: null, visibilitySm: 6, sky: "partly", precip: null });
    // FM2100: the lowest broken layer the ceiling (14 CFR 1.1), MVFR, its rain and its gust.
    expect(byTime("2026-10-29T21:00:00Z")).toMatchObject({
      category: "MVFR", ceilingFt: 2500, visibilitySm: 5, sky: "cloudy", precip: "rain",
      windDirTrueDeg: 290, windSpeedKt: 15, windGustKt: 22, atTimes: null,
    });
    expect(byTime("2026-10-30T00:00:00Z").category).toBe("MVFR");
    expect(byTime("2026-10-30T01:00:00Z")).toMatchObject({ category: "VFR", windGustKt: null });
    expect(sentenceOf(hours, zulu)).toBe("Ceilings lowering to 2,500 ft around 2100Z, MVFR until 0100Z. Gusts up to 22 kt.");
  });

  it("says when it gets better, from the report now", () => {
    const ifr: Metar = { ...VFR_METAR, raw: "KDLH 291753Z 27008KT 2SM BR OVC008 08/07 A2990", flight_category: "IFR", ceiling_ft: 800, visibility_sm: 2 };
    const hours = series("TAF KDLH 291720Z 2918/3018 27008KT 2SM BR OVC008 FM292100 29010KT P6SM SCT040", ifr);
    expect(hours[0]).toMatchObject({ category: "IFR", sky: "cloudy" });
    expect(hours.find(h => h.at === at("2026-10-29T20:00:00Z"))!.category).toBe("IFR");
    expect(sentenceOf(hours, zulu)).toBe("IFR now, VFR from around 2100Z.");
  });

  it("a BECMG keeps what it does not change, and until it is done the hour is the worse of before and after", () => {
    const hours = series("TAF KMSP 291740Z 2918/3024 18010KT P6SM BKN040 BECMG 2922/2924 OVC012 BECMG 3003/3005 P6SM SCT030");
    const byTime = (iso: string) => hours.find(h => !h.now && h.at === at(iso))!;
    expect(byTime("2026-10-29T21:00:00Z")).toMatchObject({ category: "VFR", ceilingFt: 4000 });
    // Getting worse: the new weather from the start of its window, the
    // wind and visibility the group leaves out kept.
    expect(byTime("2026-10-29T22:00:00Z")).toMatchObject({ category: "MVFR", ceilingFt: 1200, visibilitySm: 6, windDirTrueDeg: 180, windSpeedKt: 10 });
    // Getting better between 03Z and 05Z: still the worse until it is done.
    expect(byTime("2026-10-30T03:00:00Z")).toMatchObject({ category: "MVFR", ceilingFt: 1200 });
    expect(byTime("2026-10-30T04:00:00Z")).toMatchObject({ category: "MVFR" });
    expect(byTime("2026-10-30T05:00:00Z")).toMatchObject({ category: "VFR", ceilingFt: null, sky: "partly" });
    expect(sentenceOf(hours, zulu)).toBe("Ceilings lowering to 1,200 ft around 2200Z, MVFR until 0500Z.");
  });

  it("a TEMPO is the weather at times, not the hour's own, and its cloud or visibility left out is the prevailing's", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27010KT P6SM SCT035 TEMPO 2920/2923 2SM -SHRA BKN015 FM300300 30008KT P6SM SKC");
    const byTime = (iso: string) => hours.find(h => !h.now && h.at === at(iso))!;
    expect(byTime("2026-10-29T19:00:00Z")).toMatchObject({ category: "VFR", atTimes: null });
    for (const iso of ["2026-10-29T20:00:00Z", "2026-10-29T21:00:00Z", "2026-10-29T22:00:00Z"]) {
      expect(byTime(iso)).toMatchObject({ category: "VFR", ceilingFt: null, atTimes: "IFR" });
    }
    expect(byTime("2026-10-29T23:00:00Z").atTimes).toBeNull();
    expect(byTime("2026-10-30T03:00:00Z")).toMatchObject({ category: "VFR", sky: "clear" });
    expect(sentenceOf(hours, zulu)).toBe("Staying VFR through 0500Z. At times IFR between 2000Z and 2300Z.");
  });

  it("a PROB group is a chance of the weather, not weather at times", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27010KT P6SM SCT035 PROB30 3001/3004 2SM -SHRA BKN015 FM300600 30008KT P6SM SKC");
    expect(hours.find(h => h.at === at("2026-10-30T01:00:00Z"))).toMatchObject({ category: "VFR", atTimes: "IFR", atTimesChance: true });
    expect(sentenceOf(hours, zulu)).toBe("Staying VFR through 0500Z. Chance of IFR between 0100Z and 0400Z.");
  });

  it("the strongest gust is said, a TEMPO's among them, and thunder at times", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27010G18KT P6SM SCT050 TEMPO 2920/2923 25020G35KT 4SM TSRA BKN030CB FM300300 30008KT P6SM SKC");
    const storm = hours.find(h => h.at === at("2026-10-29T20:00:00Z"))!;
    expect(storm).toMatchObject({ category: "VFR", windGustKt: 18, atTimes: "MVFR", atTimesGustKt: 35, atTimesThunder: true, precip: null });
    expect(sentenceOf(hours, zulu)).toBe("Staying VFR through 0500Z. At times MVFR between 2000Z and 2300Z. Thunderstorms around 2000Z. Gusts up to 35 kt.");
  });

  it("with no TAF, Now alone and a sentence from the METAR; with neither, nothing", () => {
    const hours = series(null);
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ now: true, category: "VFR" });
    expect(sentenceOf(hours, zulu)).toBe("VFR now, no forecast for this field.");
    expect(series(null, null)).toEqual([]);
    expect(sentenceOf([], zulu)).toBeNull();
    expect(tafOf("", NOW)).toBeNull();
  });

  it("with no METAR, Now is the TAF's for this moment", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27010KT 3SM BR OVC015 FM292300 30008KT P6SM SKC", null);
    expect(hours[0]).toMatchObject({ now: true, at: NOW, category: "MVFR", ceilingFt: 1500 });
    expect(sentenceOf(hours, zulu)).toBe("MVFR now, VFR from around 2300Z.");
  });

  it("a planned arrival falls in the hour it is in, Now's where it is before the first hour", () => {
    const hours = series("TAF KDLH 291720Z 2918/3018 27012KT P6SM SCT050");
    expect(arrivalHour(hours, at("2026-10-29T20:40:00Z"))).toBe(hours.findIndex(h => h.at === at("2026-10-29T20:00:00Z")));
    expect(arrivalHour(hours, at("2026-10-29T18:40:00Z"))).toBe(0);
    expect(arrivalHour(hours, at("2026-10-29T16:00:00Z"))).toBeNull();
    expect(arrivalHour(hours, at("2026-10-31T16:00:00Z"))).toBeNull();
    expect(arrivalHour(hours, null)).toBeNull();
  });
});
