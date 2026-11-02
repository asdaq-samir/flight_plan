import { garminText, namedPoints, type PlanPoint } from "./points";

/**
 * A Garmin flight plan (.fpl): the FlightPlan v1 schema
 * (www8.garmin.com/xmlschemas/FlightPlanv1.xsd) the G1000 and NXi, the G3X
 * Touch, MGL and Garmin Pilot and ForeFlight import. Each point once in its
 * table by identifier, type and ICAO region (the schema's key), then the
 * route through them in order. A user waypoint has an empty region, as the
 * schema says it should.
 */

function xml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const coordinate = (n: number) => n.toFixed(6);

export function fplOf(points: PlanPoint[], name: string, created = new Date()): string {
  const named = namedPoints(points);
  const table = [...new Map(named.map(p => [`${p.id}:${p.type}:${p.region}`, p])).values()];
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">`,
    `  <created>${created.toISOString().replace(/\.\d+Z$/, "Z")}</created>`,
    `  <waypoint-table>`,
    ...table.map(p => [
      `    <waypoint>`,
      `      <identifier>${xml(p.id)}</identifier>`,
      `      <type>${p.type}</type>`,
      `      <country-code>${p.region}</country-code>`,
      `      <lat>${coordinate(p.lat)}</lat>`,
      `      <lon>${coordinate(p.lon)}</lon>`,
      `      <comment>${xml(garminText(p.name))}</comment>`,
      `    </waypoint>`,
    ].join("\n")),
    `  </waypoint-table>`,
    `  <route>`,
    `    <route-name>${xml(garminText(name))}</route-name>`,
    `    <flight-plan-index>1</flight-plan-index>`,
    ...named.map(p => [
      `    <route-point>`,
      `      <waypoint-identifier>${xml(p.id)}</waypoint-identifier>`,
      `      <waypoint-type>${p.type}</waypoint-type>`,
      `      <waypoint-country-code>${p.region}</waypoint-country-code>`,
      `    </route-point>`,
    ].join("\n")),
    `  </route>`,
    `</flight-plan>`,
    "",
  ].join("\n");
}
