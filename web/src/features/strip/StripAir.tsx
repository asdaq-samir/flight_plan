import type { ReactNode } from "react";
import { useOwnShip } from "../../lib/map/ownShip";
import type { NavLogRow } from "../plan/components/navlog/rows";
import { RibbonLine } from "./StripRibbon";
import { positionAlong, ribbonPoints } from "./stripData";

/**
 * The strip in the air (useFlyingMode), the sheet's foot at every size:
 * the ribbon with the airplane on it, the flown part grey and the way
 * ahead magenta, over the flight's figures grown (FlightLine's `flying`,
 * the planner's own) and the field as the radio (OneField). The next
 * checkpoint is the flying head's over the map (FlyingHead).
 */
export default function StripAir({ rows, figures, field }: { rows: NavLogRow[]; figures: ReactNode; field: ReactNode }) {
  const position = useOwnShip(s => {
    const at = s.enabled && s.fix ? positionAlong(rows, s.fix) : null;
    // One string, so a fix a few feet on does not draw the strip again.
    return at ? `${at.leg} ${at.along.toFixed(2)}` : "";
  });
  const [leg, along] = position.split(" ");
  return (
    <div className="flex w-full min-w-0 flex-col gap-2" data-testid="strip-air">
      <RibbonLine points={ribbonPoints(rows)} position={position ? { leg: Number(leg), along: Number(along) } : null} className="px-1" />
      {figures}
      {field}
    </div>
  );
}
