import { useMemo } from "react";
import { cn } from "cn";
import { areaFrom, lineEnters, outsides } from "../areaPlace";
import { useOwnFix } from "./ownShip";
import { usePointActions } from "./pointActions";
import { Ban } from "lucide-react";
import { RowBadge } from "../../components/RowBadge";
import { BADGE } from "../rowBadges";
import { faaWords, tfrAltitudes, tfrPage, tfrTimes } from "../advisories";
import type { Tfr } from "../api/types";
import { MapCard } from "./MapCard";

/**
 * A temporary flight restriction's ink, whether it is in force, and its
 * card (the map draws them: lib/map/gl/layers/TfrGl).
 */

/** The FAA's own TFR red, as tfr.faa.gov and every EFB draw one. */
export const TFR_RED = "#dc2626";

/** Whether a TFR is in force now: one with no times is taken as so. */
export function inForce(tfr: Tfr, now: number): boolean {
  const from = tfr.effective ? Date.parse(tfr.effective) : -Infinity;
  const to = tfr.expires ? Date.parse(tfr.expires) : Infinity;
  return from <= now && now <= to;
}

export function TfrCard({ tfr, active }: { tfr: Tfr; active: boolean }) {
  const rings = useMemo(() => outsides(tfr.geometry as { type?: string; coordinates?: unknown }), [tfr.geometry]);
  const line = usePointActions(s => s.courseLine);
  const enters = useMemo(() => !!line && rings.length > 0 && lineEnters(rings, line), [rings, line]);
  const ship = useOwnFix();
  const from = ship ? areaFrom(rings, ship) : null;
  return (
    <MapCard
      // A TFR's badge, red while it is in force, as its shape is drawn.
      media={<RowBadge colour={active ? TFR_RED : BADGE.other}><Ban /></RowBadge>}
      title={`TFR ${tfr.notam_id}`} subtitle={[tfr.kind, active ? "In force now" : "Not yet in force"].filter(Boolean).join(" · ")}
    >
      <div className="space-y-1 text-left" data-testid="tfr-card">
        {tfrAltitudes(tfr) && <p>{tfrAltitudes(tfr)}</p>}
        {tfrTimes(tfr) && <p>{tfrTimes(tfr)}</p>}
        {/* The FAA's capitals in sentence case, its codes kept (faaWords),
            as the Brief sets the same TFR's purpose. */}
        {(tfr.purpose ?? tfr.rule) && <p className="text-muted-foreground">{faaWords(tfr.purpose ?? tfr.rule)}</p>}
        {/* Where it is to the pilot, at the owner's ask for cards that
            say what a pilot does there (2026-10-30): whether the route
            goes through it, and how far it is. */}
        {rings.length > 0 && line && (
          <p className={cn(enters ? "font-semibold text-caution-ink" : "text-muted-foreground")} data-testid="tfr-route">
            {enters ? "Your route goes through it" : "Clear of your route"}
          </p>
        )}
        {from && <p data-testid="tfr-from">{from}</p>}
        <a className="text-tint" href={tfrPage(tfr.notam_id)} target="_blank" rel="noreferrer">
          The NOTAM on tfr.faa.gov
        </a>
      </div>
    </MapCard>
  );
}

