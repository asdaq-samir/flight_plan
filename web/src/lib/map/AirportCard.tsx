import { type ReactNode } from "react";
import { MapCard } from "./MapCard";

/**
 * A training corridor's endpoint on the map: its ident with the tag the
 * caller gives it (DEP or DEST, since a corridor's endpoint is never
 * checked for weather) and the field's name under it.
 */
export function AirportCard({ ident, name, badge }: { ident: string; name: string; badge: ReactNode }) {
  return <MapCard subtitle={name} title={<span className="flex items-baseline gap-2">{ident}{badge}</span>} />;
}
