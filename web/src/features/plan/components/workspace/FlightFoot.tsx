import { Suspense } from "react";
import { cn } from "cn";
import { TEXT } from "../../../../lib/text";
import FlightLine from "../FlightLine";
import DirectStrip from "../DirectStrip";
import { DryRunFigures } from "../../routePanelParts";
import type { PlanWorkspaceModel } from "../../hooks/usePlanWorkspace";

/** FPL's figures pinned at the sheet's foot (PlanWorkspace's `foot`): the
 *  dry run's while it plays, else a Direct to's strip and the flight's
 *  line, and in flight Done flying. */
export default function FlightFoot({ vm }: { vm: PlanWorkspaceModel }) {
  const {
    depart, directParam, directToPoint, doneFlying, dryRunning, estimate, firstFuelStop, flying, navLogShown, planned, profileShown, s,
  } = vm;
  // In flight, the one way out of flying mode (useFlyingMode): a small
  // Done flying at the figures' foot, as the canvas has the line there;
  // the tabs come back on the ground by themselves.
  const doneFlyingRow = flying && (
    <div className={cn("flex items-center justify-between pt-1 text-foreground/65", TEXT.note)} data-testid="flying-foot">
      <span>Flying</span>
      <button type="button" className="relative font-semibold text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']" data-testid="done-flying" onClick={doneFlying}>
        Done flying
      </button>
    </div>
  );
  return (
    // Its own 16 at the sides under the nav log's card, whose foot
    // MapPanel leaves bare for a card's summary to set (cardInPill): the
    // side view's figures sat 8 from the edge there (the iOS audit's P18).
    <div className={cn("flex min-h-0 w-full flex-col", (navLogShown || profileShown) && "px-4")}>
      {dryRunning ? (
        <Suspense fallback={null}>
          <DryRunFigures run={dryRunning} totals={s.totals} estimate={estimate} destination={`${planned.dest}`} depart={depart} local={s.local} flying={flying} />
        </Suspense>
      ) : (
        <>
        {/* Flown direct to a point: said over the figures, and Cancel.
            Put away in the pill, whose one row is the figures. */}
        {directParam && <div data-pill-hides=""><DirectStrip ident={directParam} onCancel={() => directToPoint(null)} /></div>}
        <div data-testid="flight-line">
          <FlightLine totals={s.totals} estimate={estimate} destination={`${planned.dest}`} depart={depart} local={s.local} grow flying={flying} fuelStop={firstFuelStop} />
        </div>
        </>
      )}
      {doneFlyingRow}
    </div>
  );
}
