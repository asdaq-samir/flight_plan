import { Suspense, lazy } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import { clockTime } from "../../../lib/clock";
import { REPLAY_SPEEDS, pausePastFlight, playPastFlight, positionAt, usePastFlight } from "../../../lib/map/pastFlight";
import FigureStrip from "../../../components/FigureStrip";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import { dryRunAt, type DryRun } from "./navlog/dryRun";
import { TRACES } from "./flightTraces";
import { when } from "./pastFlightFormat";

const FlightChart = lazy(() => import("./PastFlightChart"));

/**
 * The planned flight flown on paper, at the owner's ask ("a dry run of the
 * flight with altitude and speed profile as well as the calculations at
 * the bottom"): its height and ground speed across the flight, the moment
 * marked and said over it, its controls on it -- from the start again,
 * play or pause, how fast, and the close (a past flight's replay's chart,
 * PastFlightChart), the airplane flown along the course on the map
 * (DryRunLayer). In FPL's foot in the side view's place, the figures
 * under it (DryRunFigures); the chart growing with the sheet.
 */
export function DryRunControls({ run, onClose }: { run: DryRun; onClose: () => void }) {
  const playing = usePastFlight(s => s.playing);
  const speed = usePastFlight(s => s.speed);
  const second = usePastFlight(s => (s.at === null ? null : Math.floor(s.at)));
  const here = second === null ? null : positionAt(run.points, second);
  const again = () => usePastFlight.setState({ at: run.points[0]?.t ?? null, playing: true });
  // The speeds in turn, a tap each: one small button on the chart, where
  // a segmented control took a row of its own.
  const nextSpeed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number]) + 1) % REPLAY_SPEEDS.length]!;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-xl bg-background/70 px-1 pt-1" data-testid="dry-run">
      <p className={cn("flex min-h-9 items-center gap-2 pr-[10.5rem] pl-2 tabular-nums", TEXT.detail)}>
        {/* Each figure in its trace's colour (flightTraces), in place of the
            chart's axes, at the owner's ask. */}
        {here ? (
          <span className="truncate font-semibold" data-testid="dry-run-now">
            <span className={TRACES.alt.text}>{altFt(here.alt_ft)} ft</span>
            <span className="text-muted-foreground"> · </span>
            <span className={TRACES.kt.text}>{here.gs_kt != null ? `${Math.round(here.gs_kt)} kt` : "—"}</span>
          </span>
        ) : (
          <span className="truncate">
            <span className={TRACES.alt.text}>Altitude, ft</span>
            <span className="text-muted-foreground"> · </span>
            <span className={TRACES.kt.text}>ground speed, kt</span>
          </span>
        )}
      </p>
      {/* Its controls on the chart, at its top right, where the side view's
          play is, at the owner's ask ("can the control buttons for the dry
          run be on the profile graph just like the play button"): from the
          start, play or pause, how fast, and the close. Eight apart, their
          44-point hit areas their own (index.css). */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-2">
        <RoundButton label="From the start" onClick={again} data-testid="dry-run-again">
          <RotateCcw className="size-4" />
        </RoundButton>
        <RoundButton label={playing ? "Pause" : "Play"} onClick={playing ? pausePastFlight : playPastFlight} data-testid="dry-run-play">
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </RoundButton>
        <RoundButton
          label={`${speed} times as fast; ${nextSpeed} times next`} onClick={() => usePastFlight.setState({ speed: nextSpeed })}
          className={cn("w-auto px-2 font-semibold tabular-nums", TEXT.note)} data-testid="dry-run-speed"
        >
          {speed}×
        </RoundButton>
        <CloseButton onClick={onClose} data-testid="dry-run-close" />
      </div>
      {/* Short at the pill, taller as the sheet comes up; in the pill all
          the room its row leaves over the figures. */}
      <div className="min-h-[calc(4rem+5rem*var(--sheet-progress,1))] flex-1">
        <Suspense fallback={<div className="h-full" />}>
          <FlightChart points={run.points} at={second} alongNm={run.alongNm} />
        </Suspense>
      </div>
    </div>
  );
}

const hoursMinutes = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** The figures as the dry run goes, in the flight figures' place at the
 *  panel's foot: the distance and time still to fly, the arrival, and the
 *  fuel still to burn of the plan's. */
export function DryRunFigures({ run }: { run: DryRun }) {
  const at = usePastFlight(s => s.at);
  const start = run.points[0]?.t ?? 0;
  const left = dryRunAt(run, at ?? start);
  const total = run.fuelGal.at(-1) ?? 0;
  const figures = [
    { name: "Dist left", value: left ? left.leftNm.toFixed(1) : "—", unit: "nm" },
    { name: "Time left", value: left ? hoursMinutes(left.leftS) : "—" },
    { name: "ETA", value: run.points.length ? clockTime(when(run.points.at(-1)!.t)) : "—" },
    { name: "To burn", value: left ? (total - left.burntGal).toFixed(1) : "—", unit: "gal" },
  ];
  // The figures every tab pins at the panel's foot, one look for all of
  // them (FigureStrip), growing as the sheet comes up, at the owner's ask
  // ("keep the calculations pinned down at the bottom for dry run as well.
  // That should be common theme for all layouts").
  return <FigureStrip figures={figures} testId="dry-run-figures" />;
}
