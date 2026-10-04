import type { ShortField } from "./api/types";

/** A standard day's temperature at an altitude, as vfr.performance has it. */
export const isaTempC = (altitudeFt: number) => 15 - 0.0019812 * altitudeFt;

/** The field's pressure altitude from its elevation and the altimeter
 *  setting reported: a thousand feet for every inch under 29.92. */
export const pressureAltitudeFt = (elevationFt: number, altimeterInHg: number | null | undefined) =>
  elevationFt + (altimeterInHg ? (29.92 - altimeterInHg) * 1000 : 0);

export interface Distances {
  groundRollFt: number;
  totalFt: number;
  /** What could not be had from the table: beyond its altitudes or
   *  temperatures (where its edge is taken), or a tailwind past ten. */
  caveats: string[];
}

/** A value between table points, its edge where it is beyond them. */
function at(points: number[], value: number): { i: number; f: number; beyond: boolean } {
  const n = points.length;
  if (value <= points[0]!) return { i: 0, f: 0, beyond: value < points[0]! };
  if (value >= points[n - 1]!) return { i: n - 2, f: 1, beyond: value > points[n - 1]! };
  let i = 0;
  while (points[i + 1]! < value) i++;
  return { i, f: (value - points[i]!) / (points[i + 1]! - points[i]!), beyond: false };
}

function bilinear(grid: number[][], row: { i: number; f: number }, col: { i: number; f: number }): number {
  const g = (r: number, c: number) => grid[r]![c]!;
  const top = g(row.i, col.i) + (g(row.i, col.i + 1) - g(row.i, col.i)) * col.f;
  const bottom = g(row.i + 1, col.i) + (g(row.i + 1, col.i + 1) - g(row.i + 1, col.i)) * col.f;
  return top + (bottom - top) * row.f;
}

/**
 * A POH's short-field distances (ShortField) at a pressure altitude,
 * temperature and weight: read between the table's altitudes and
 * temperatures, and between its weights (a weight under the lightest
 * table taken at that table, which is the longer); then its notes -- a
 * tenth less for every 9 kt of headwind, a tenth more for every 2 kt of
 * tailwind up to 10 -- and on dry grass the ground roll's share more.
 */
export function shortField(table: ShortField, pressureAltFt: number, tempC: number, weightLb: number, headwindKt: number, grass: boolean): Distances {
  const caveats: string[] = [];
  const row = at(table.pressure_altitudes_ft, pressureAltFt);
  const col = at(table.temperatures_c, tempC);
  if (row.beyond) caveats.push("the field is higher than the table goes");
  if (col.beyond) caveats.push("the temperature is beyond the table's");
  // Weights heaviest first; read between the two either side.
  const weights = table.weights_lb;
  const read = (key: "ground_roll_ft" | "total_50ft_ft") => {
    const values = table.tables.map(t => bilinear(t[key], row, col));
    if (weights.length === 1 || weightLb >= weights[0]!) return values[0]!;
    for (let k = 0; k < weights.length - 1; k++) {
      if (weightLb >= weights[k + 1]!) {
        const f = (weights[k]! - weightLb) / (weights[k]! - weights[k + 1]!);
        return values[k]! + (values[k + 1]! - values[k]!) * f;
      }
    }
    return values[values.length - 1]!;
  };
  let roll = read("ground_roll_ft");
  let total = read("total_50ft_ft");
  const factor = headwindKt >= 0 ? 1 - 0.1 * (headwindKt / 9) : 1 + 0.1 * (-headwindKt / 2);
  if (headwindKt < -10) caveats.push("the POH gives no figures for a tailwind over 10 kt");
  roll *= factor;
  total *= factor;
  if (grass) {
    const added = (table.grass_ground_roll_pct / 100) * roll;
    roll += added;
    total += added;
  }
  return { groundRollFt: Math.round(roll / 5) * 5, totalFt: Math.round(total / 5) * 5, caveats };
}
