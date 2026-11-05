import { cn } from "cn";
import { ChartMark, PillStrip, SmallTile, TileChartMark } from "../../../components/Favorites";
import type { NearestAirport } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { nmAway } from "../../../lib/useAway";
import { useOwnShip } from "../../../lib/map/ownShip";
import { TEXT } from "../../../lib/text";

// Apart from Nearest's list in full (NearestCard), which is loaded when it
// is opened: the strip is drawn with Airport's pill, in the first load.

/** How many fields the pill shows, nearest first; more slide in sideways. */
const STRIP_FIELDS = 8;

/**
 * Airport's pill's NEAREST strip, under the Favorites, at the owner's ask ("Nearest can show
 * nearby airports as small icons"): the nearest fields as small tiles,
 * each its chart mark -- its airspace's colour, its weather's dot -- its
 * ident and how far, nearest first; a tap opens the field's card, as a row
 * of the list does. With no position yet, the way to show it. The list in
 * full is the tab's, half way up.
 */
export function NearestStrip({ fields, located, onOpen }: {
  fields: NearestAirport[] | undefined;
  /** Whether there is a position (or a place typed) to be near. */
  located: boolean;
  onOpen: (ident: string) => void;
}) {
  const setEnabled = useOwnShip(s => s.setEnabled);
  if (!located) {
    return (
      <button
        type="button" onClick={() => setEnabled(true)} data-testid="nearest-strip-position"
        className={cn("relative mx-auto block px-2 py-1 text-tint after:absolute after:-inset-y-2 after:inset-x-0", TEXT.row)}
      >
        Show my position
      </button>
    );
  }
  if (!fields) return <p className={cn("py-1 text-center text-foreground/65", TEXT.note)} role="status">Fetching the nearest fields…</p>;
  return (
    <PillStrip testId="nearest-strip">
      {fields.slice(0, STRIP_FIELDS).map(field => {
        const use = field.military === "military" ? "military" : field.private ? "private" : null;
        return (
          <SmallTile
            key={field.ident} onClick={() => onOpen(field.ident)} testId="nearest-strip-field"
            label={`${field.ident}, ${field.name}, ${nmAway(field.distance_nm)} ${compassPoint(field.bearing_deg)}`}
            mark={<TileChartMark><ChartMark space={field.airspace_class ?? null} category={field.flight_category} use={use} size={44} /></TileChartMark>}
            title={field.ident} detail={nmAway(field.distance_nm)}
          />
        );
      })}
    </PillStrip>
  );
}
