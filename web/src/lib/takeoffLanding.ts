/**
 * A POH's short-field distances, as the shared engine answers them
 * (native/crates/brief/src/runway/performance.rs, through lib/engine and
 * lib/runwayCheck), the very code behind the planner's runway check and
 * the phones': the rules and their sources live there.
 */
export interface Distances {
  groundRollFt: number;
  totalFt: number;
  /** What could not be had from the table: beyond its altitudes or
   *  temperatures (where its edge is taken), or a tailwind past ten. */
  caveats: string[];
}
