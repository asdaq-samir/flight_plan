/** The planning panel's tabs that hold the briefing's sections, each a
 *  part of FlightBriefingView, in the order the flight is flown, at the
 *  owner's pick of the redesign ("I like C concept"): Preflight (the go /
 *  no-go and the paperwork), Depart, En route and Arrive -- and under the
 *  En route's profile its Cruise Altitude. A module of its own, so the
 *  component's file keeps fast refresh. */
export type BriefingPart = "preflight" | "depart" | "enroute" | "arrive" | "profile";

/** Where along the flight a place's sections belong: its departure, a
 *  stop on the way, or its destination. */
export type Phase = "depart" | "enroute" | "arrive";

/** A field's phase by its place among those landed at: one alone (a local
 *  flight) both leaves and lands there. */
export const phasesOf = (index: number, count: number): Phase[] =>
  count === 1 ? ["depart", "arrive"] : index === 0 ? ["depart"] : index === count - 1 ? ["arrive"] : ["enroute"];
