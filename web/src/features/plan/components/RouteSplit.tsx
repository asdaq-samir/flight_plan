import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { PANEL_FIELD_FILL } from "../../../components/panelField";
import { pointName } from "../../../lib/identSchema";
import { TEXT } from "../../../lib/text";

/** The course's magenta, as the plan's line and its marks. */
const COURSE = { borderColor: "var(--course)" } as const;

/**
 * FPL's route on one line (lib/preferences RouteEdit "folded"), the
 * owner's pick L1 of the FPL canvas (2026-11-05: "Let's try L1"): one
 * capsule split in three, the departure at its left and the destination
 * at its right, each its own tap to change it (the stock airport picker,
 * its sheet with Home, the Favorites and the Recents), and between them
 * the stops -- "1 stop", a tap the route's box to change them -- or with
 * none an arrow, a tap a stop typed in before the destination. Each end
 * its ident over the airport's name, where the planner has given it.
 * With no route the two ends' words; the airplane and the altitude come
 * with the route, under the line (PlanWorkspace).
 */
export default function RouteSplit({ dep, dest, stops, depName, destName, onDep, onDest, onStops }: {
  dep: string;
  dest: string;
  stops: string[];
  /** The ends' names as the plan has them (placeName), none before it. */
  depName?: string | null;
  destName?: string | null;
  onDep: (ident: string) => void;
  onDest: (ident: string) => void;
  /** The stops tapped: the box, to change them or type one in. */
  onStops: () => void;
}) {
  const many = stops.length;
  return (
    <div className={cn("flex h-[3.25rem] min-w-0 flex-1 items-center rounded-[1.625rem]", PANEL_FIELD_FILL)} data-testid="route-split">
      <End value={dep} name={depName} onChange={onDep} label="Departure" testId="route-split-departure">
        <Mark round filled={!!dep} />
      </End>
      <button
        type="button" onClick={onStops} disabled={!dep || !dest} data-testid="route-split-stops"
        aria-label={many ? `${many} ${many === 1 ? "stop" : "stops"}: ${stops.map(pointName).join(", ")}. Change` : "Add a stop"}
        className={cn(
          "relative flex h-7 shrink-0 items-center gap-1 rounded-full px-2 font-semibold text-tint outline-none after:absolute after:-inset-2 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground",
          many > 0 && "bg-foreground/6",
          TEXT.note,
        )}
      >
        <ArrowRight className="size-3.5" aria-hidden />
        {many > 0 && <>{many === 1 ? "1 stop" : `${many} stops`}<ArrowRight className="size-3.5" aria-hidden /></>}
      </button>
      <End value={dest} name={destName} onChange={onDest} label="Destination" testId="route-split-destination" end>
        <Mark filled={!!dest} />
      </End>
    </div>
  );
}

function End({ value, name, onChange, label, testId, end = false, children }: {
  value: string;
  name?: string | null;
  onChange: (ident: string) => void;
  label: string;
  testId: string;
  /** The destination's, its words at the right, its mark after them. */
  end?: boolean;
  /** Its mark. */
  children: ReactNode;
}) {
  return (
    <AirportPicker
      value={value} onChange={onChange} placeholder={label} ariaLabel={value ? `${label} ${value}, change` : label} testId={testId}
      className={cn("h-full min-w-0 flex-1 gap-2 rounded-[1.625rem] bg-transparent px-3.5 shadow-none hover:bg-transparent", end ? "justify-end" : "justify-start")}
    >
      {!end && children}
      <span className={cn("flex min-w-0 flex-col leading-tight", end && "items-end")}>
        {value ? (
          <>
            <span className={cn("truncate font-mono font-semibold uppercase", TEXT.row)}>{pointName(value)}</span>
            {name && <span className={cn("max-w-full truncate font-sans font-normal normal-case text-muted-foreground", TEXT.note)}>{name}</span>}
          </>
        ) : (
          <span className={cn("truncate font-sans font-normal normal-case text-muted-foreground", TEXT.row)}>{label}</span>
        )}
      </span>
      {end && children}
    </AirportPicker>
  );
}

/** The departure's mark a circle, the destination's a square, in the
 *  course's magenta: dashed until the end is picked. */
function Mark({ round = false, filled }: { round?: boolean; filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-3 shrink-0 border-[3px]", round ? "rounded-full" : "rounded-[3px]", filled ? "border-solid" : "border-dashed")}
      style={COURSE}
    />
  );
}
