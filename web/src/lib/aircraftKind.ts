import type { AircraftRegistration } from "./api/types";
import { callEngine } from "./engine/engine";

/**
 * Which of the seven shapes an airplane is drawn as in the lists of
 * airplanes kept (Favorites, Recents, My Airplane), at the owner's ask
 * ("shouldn't we do different icons for different types of planes?",
 * 2026-11-04; the map's traffic keeps its one arrow). Read from what is
 * known of it, the surest first: the FAA registry's aircraft type, engine
 * type and engine count (the Releasable Aircraft Database's ACFTREF, in
 * wingtip.registry's words); its transponder's emitter category, named
 * by the engine (emitter_category, DO-260B's names); then its ICAO type designator (ICAO Doc 8643).
 * Neither the registry nor ADS-B says where the wing is, so a single's
 * high or low wing is by model, high where the model is not known.
 */
export type AircraftKind = "high" | "low" | "twin" | "jet" | "helicopter" | "glider" | "balloon";

export interface KindClues {
  /** ICAO type designator, as ADS-B and the kept airplane carry it. */
  type?: string | null;
  /** The transponder's emitter category ("A1" … "B2"). */
  category?: string | null;
  faa?: Pick<AircraftRegistration, "aircraft_type" | "engines" | "engine_type" | "manufacturer" | "model"> | null;
}

// ICAO Doc 8643 designators of the commonest of each, where the category
// does not say: what a pilot keeps and opens most.
const HELICOPTERS = new Set(["R22", "R44", "R66", "B06", "B407", "B429", "B412", "EC20", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65", "H500", "MD52", "S76", "A109", "A119", "A139", "A169", "BK17", "H60"]);
const JETS = new Set(["C25A", "C25B", "C25C", "C25M", "C501", "C510", "C525", "C550", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750", "E50P", "E55P", "E545", "E550", "HDJT", "SF50", "PC24", "EA50", "LJ31", "LJ35", "LJ40", "LJ45", "LJ60", "LJ75", "GLF4", "GLF5", "GLF6", "G280", "GLEX", "GL5T", "GL7T", "CL30", "CL35", "CL60", "FA20", "FA50", "FA7X", "FA8X", "F2TH", "F900", "BE40", "PRM1", "H25B", "ASTR", "GALX"]);
const TWINS = new Set(["PA23", "PA30", "PA31", "PA34", "PA44", "PA60", "P31T", "BE55", "BE58", "BE60", "BE76", "BE95", "BE9L", "BE9T", "BE10", "BE20", "BE30", "B350", "C303", "C310", "C320", "C335", "C340", "C402", "C404", "C414", "C421", "C425", "C441", "DA42", "DA62", "P68", "AC50", "AC90", "AEST", "PA27", "DHC6", "SW4", "B190", "MU2"]);
// Singles whose wing is under the fuselage; the rest are drawn high wing.
const LOW_WING = new Set(["PA24", "PA25", "PA28", "P28A", "P28B", "P28R", "P28T", "PA32", "P32R", "P32T", "PA38", "PA46", "P46T", "SR20", "SR22", "S22T", "BE19", "BE23", "BE24", "BE33", "BE35", "BE36", "BE77", "M20P", "M20T", "DA40", "DV20", "AA1", "AA5", "COL3", "COL4", "LNC4", "TBM7", "TBM8", "TBM9", "PC12", "TB10", "TB20", "TB21", "G115", "RV4", "RV6", "RV7", "RV8", "RV9", "RV10", "RV12", "RV14", "T6", "P51", "BT36"]);
// The registry's makers whose singles are low wing, and Piper's and
// Cessna's exceptions, by model.
const LOW_WING_MAKERS = /CIRRUS|MOONEY|DIAMOND|VANS|GRUMMAN|AMERICAN GENERAL|COLUMBIA|LANCAIR|SOCATA|DAHER|BEECH|RAYTHEON|PILATUS|GROB|TEXTRON AVIATION.*(350|400)/;
const PIPER_HIGH = /^(J-?3|J-?5|PA-?1[1-8]|PA-?2[02])/;
const CESSNA_LOW = /^(350|400|T240|LC4)/;

export function aircraftKind({ type, category, faa }: KindClues): AircraftKind {
  const what = faa?.aircraft_type ?? "";
  if (what === "Glider") return "glider";
  if (what === "Balloon" || what === "Blimp or dirigible") return "balloon";
  if (what === "Rotorcraft" || what === "Gyroplane") return "helicopter";
  const emitter = callEngine("emitter_category", { category: category ?? null });
  if (emitter === "rotorcraft") return "helicopter";
  if (emitter === "glider") return "glider";
  if (emitter === "lighter_than_air") return "balloon";
  const designator = type?.toUpperCase().trim() ?? "";
  if (HELICOPTERS.has(designator)) return "helicopter";
  if (JETS.has(designator) || faa?.engine_type === "Turbo-fan" || faa?.engine_type === "Turbo-jet") return "jet";
  // Large, heavy and high-performance: airliners and the bigger jets.
  if (emitter === "large" || emitter === "high_vortex_large" || emitter === "heavy" || emitter === "high_performance") return "jet";
  if (TWINS.has(designator) || (faa?.engines ?? 0) >= 2 || what === "Fixed wing multi engine") return "twin";
  if (LOW_WING.has(designator)) return "low";
  const maker = faa?.manufacturer?.toUpperCase() ?? "";
  const model = faa?.model?.toUpperCase() ?? "";
  if (maker.includes("PIPER")) return PIPER_HIGH.test(model) ? "high" : "low";
  if (maker.includes("CESSNA")) return CESSNA_LOW.test(model) ? "low" : "high";
  if (LOW_WING_MAKERS.test(`${maker} ${model}`)) return "low";
  return "high";
}

/** A kept airplane's shape: the one worked out when it was kept, else
 *  from its type designator alone (airplanes kept before there were
 *  shapes). */
export function keptKind(kept: { type: string | null; kind?: AircraftKind }): AircraftKind {
  return kept.kind ?? aircraftKind({ type: kept.type });
}
