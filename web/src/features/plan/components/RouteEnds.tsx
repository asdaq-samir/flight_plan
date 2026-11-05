import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { TEXT } from "../../../lib/text";

/** The course's magenta, as the plan's line between its cards. */
const ROUTE_LINE = { borderColor: "var(--course)" } as const;

/**
 * FPL's two lines before there is a route, where the route is changed in
 * the plan (lib/preferences RouteEdit "plan"), at the owner's pick of the
 * FPL canvas (2026-11-05, option 3 as cards: "On the plan should ask for
 * depart and destination on two lines, no n number or altitude"): the
 * departure and the destination each a card, as the plan's points are
 * once there is a route, on its dashed line; each the stock airport
 * picker (AirportPicker), its search a sheet with Home, the Favorites
 * and the Recents. The airplane, the altitude and the route's buttons
 * come with the route, over its Routes.
 */
export default function RouteEnds({ dep, dest, onDep, onDest }: {
  dep: string;
  dest: string;
  onDep: (ident: string) => void;
  onDest: (ident: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-2" data-testid="route-ends">
      <EndCard value={dep} onChange={onDep} label="Departure" testId="route-end-departure" round />
      <div aria-hidden="true" className="ml-[calc(1.5rem+1px)] h-3.5 border-l-[3px] border-dashed opacity-60" style={ROUTE_LINE} />
      <EndCard value={dest} onChange={onDest} label="Destination" testId="route-end-destination" />
    </div>
  );
}

function EndCard({ value, onChange, label, testId, round = false }: {
  value: string;
  onChange: (ident: string) => void;
  label: string;
  testId: string;
  /** The departure's mark a circle, the destination's a square, as the
   *  canvas drew them. */
  round?: boolean;
}) {
  return (
    <div className="flex h-14 min-w-0 items-center gap-2.5 rounded-2xl bg-card pr-1.5 pl-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <span className="grid w-7 shrink-0 place-items-center" aria-hidden="true">
        <span
          className={cn("size-4 border-[3px] border-dashed", round ? "rounded-full" : "rounded-[4px]", value && "border-solid")}
          style={ROUTE_LINE}
        />
      </span>
      {/* The whole card the field's tap; its placeholder in the words'
          own case, not the idents' capitals. */}
      <AirportPicker
        value={value} onChange={onChange} placeholder={label} ariaLabel={label} testId={testId}
        className={cn("h-full min-w-0 flex-1 justify-between rounded-xl bg-transparent px-1 shadow-none hover:bg-transparent", TEXT.row, !value && "font-sans normal-case")}
      />
    </div>
  );
}
