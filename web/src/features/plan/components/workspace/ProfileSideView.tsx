import { Suspense, lazy } from "react";
import { Play } from "lucide-react";
import RoundButton from "../../../../components/RoundButton";
import { AltitudeProfile, RouteProblem } from "../../routePanelParts";
import type { PlanWorkspaceModel } from "../../hooks/usePlanWorkspace";

// The route from the side, drawn only in the Profile's card: out of the
// first load as the lists are.
const MiniProfile = lazy(() => import("../navlog/MiniProfile"));

/** The Profile card's body (AltitudeProfile): the side view with the
 *  altitude's wheel in its corner, its dry run at its top right, and under
 *  it the altitude's figures, Class B, the rules and why. */
export default function ProfileSideView({ vm }: { vm: PlanWorkspaceModel }) {
  const {
    acceptClassB, avoidClassB, changeAltitudeChoice, classBClearance, closeProfileCard, course, dryRunReady, dryRunning, flightRules,
    flyAltitude, local, planned, routeEdit, routePoints, routed, s, selected, setAddingStop, setNewStopVia, setStops, startDryRun,
    tightLeg, typeStopAt, unflyable,
  } = vm;
  if (!routed || !course || local) return null;
  return (
    <Suspense fallback={<div className="h-56" />}>
      <AltitudeProfile
        nav={s.nav} legs={s.legs} ends={course}
        chart={(preview, scaleTop) => <Suspense fallback={null}><MiniProfile ends={course} selected={selected} legs={s.legs} preview={preview} scaleTop={scaleTop} ruler /></Suspense>}
        corner={(
          <RoundButton label="Dry run" onClick={startDryRun} disabled={!dryRunReady} className="absolute top-1.5 right-1.5" data-testid="dry-run-start">
            <Play className="size-5" />
          </RoundButton>
        )}
        wheelHidden={!!dryRunning}
        problem={unflyable ? (
          <RouteProblem
            problem={unflyable} onAddStop={() => { closeProfileCard(); if (routeEdit === "plan") typeStopAt(routePoints.length - 1); else setAddingStop("stop"); }}
            onFlyVia={() => {
              closeProfileCard();
              if (routeEdit !== "plan") return setAddingStop("via");
              // Between the points the ways round go between, as the box
              // put them (its `asked`).
              const detours = s.unflyable?.detours ?? [];
              setNewStopVia(detours.length ? detours : null);
              typeStopAt(detours.length ? detours[0]!.stop_index + 1 : routePoints.length - 1);
            }} onAcceptClassB={() => acceptClassB(true)}
            onGoRound={(via, at) => { closeProfileCard(); setStops([...planned.stops.slice(0, at), ...via, ...planned.stops.slice(at)]); }}
          />
        ) : undefined}
        tight={unflyable ? null : tightLeg}
        classBAvoided={!classBClearance} onAvoidClassB={avoidClassB} onAllowClassB={() => acceptClassB(true)}
        onGoRound={(via, at) => { closeProfileCard(); setStops([...planned.stops.slice(0, at), ...via, ...planned.stops.slice(at)]); }}
        onAltitudeChoiceChange={changeAltitudeChoice} onFlyAltitude={flyAltitude}
        // The rules' switch at the card's top right (ProfileCard's corner).
        rules={flightRules}
      />
    </Suspense>
  );
}
