import { Suspense, lazy } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import Segmented from "../../../components/Segmented";
import { clockTime } from "../../../lib/clock";
import { REPLAY_SPEEDS, pausePastFlight, playPastFlight, positionAt, usePastFlight } from "../../../lib/map/pastFlight";
import { GROUP_HEADING, TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import { dryRunAt, type DryRun } from "./navlog/dryRun";
import { when } from "./pastFlightFormat";

const FlightChart = lazy(() => import("./PastFlightChart"));
const SPEED_OPTIONS = REPLAY_SPEEDS.map(n => ({ value: String(n), label: `${n}×` }));

/**
 * The planned flight flown on paper, at the owner's ask ("a dry run of the
 * flight with altitude and speed profile as well as the calculations at
 * the bottom"): its controls -- play or pause, from the start again, how
 * fast, and the close -- over its height and ground speed across the
 * flight, the moment marked (a past flight's replay's chart,
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
  return (
    <div className="flex flex-col gap-1.5" data-testid="dry-run">
      <div className="flex items-center gap-2">
        <RoundButton label={playing ? "Pause" : "Play"} onClick={playing ? pausePastFlight : playPastFlight} data-testid="dry-run-play">
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </RoundButton>
        <RoundButton label="From the start" onClick={again} data-testid="dry-run-again">
          <RotateCcw className="size-4" />
        </RoundButton>
        <Segmented
          label="Dry run speed" value={String(speed)} onChange={v => usePastFlight.setState({ speed: Number(v) })}
          options={SPEED_OPTIONS} testId="dry-run-speed"
        />
        <span className="ml-auto"><CloseButton onClick={onClose} data-testid="dry-run-close" /></span>
      </div>
      <div className="rounded-xl bg-background/70 px-1 pt-1">
        <p className={cn("flex justify-between px-2 tabular-nums", TEXT.detail)}>
          <span className="text-muted-foreground">{here ? clockTime(when(here.t)) : "Altitude, ft · ground speed, kt"}</span>
          {here && (
            <span className="font-semibold text-foreground" data-testid="dry-run-now">
              {altFt(here.alt_ft)} ft · {here.gs_kt != null ? `${Math.round(here.gs_kt)} kt` : "—"}
            </span>
          )}
        </p>
        {/* Short at the pill, taller as the sheet comes up. */}
        <div className="h-[calc(4rem+5rem*var(--sheet-progress,1))]">
          <Suspense fallback={<div className="h-full" />}>
            <FlightChart points={run.points} at={second} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

const hoursMinutes = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** The figures as the dry run goes: the distance and time still to fly,
 *  the arrival, and the fuel still to burn of the plan's. */
export function DryRunFigures({ run }: { run: DryRun }) {
  const at = usePastFlight(s => s.at);
  const start = run.points[0]?.t ?? 0;
  const left = dryRunAt(run, at ?? start);
  const total = run.fuelGal.at(-1) ?? 0;
  const figures = [
    { name: "Dist left", value: left ? left.leftNm.toFixed(1) : "—", unit: "nm" },
    { name: "Time left", value: left ? hoursMinutes(left.leftS) : "—" },
    { name: "ETA", value: run.points.length ? clockTime(when(run.points.at(-1)!.t)) : "—" },
    { name: "Fuel to go", value: left ? (total - left.burntGal).toFixed(1) : "—", unit: "gal" },
  ];
  return (
    <dl className="grid grid-cols-4 gap-3" data-testid="dry-run-figures">
      {figures.map(f => (
        <div key={f.name} className="min-w-0">
          <dt className={cn(GROUP_HEADING, "truncate text-foreground/65")}>{f.name}</dt>
          <dd className={cn("truncate font-semibold tabular-nums leading-tight", TEXT.row)}>
            {f.value}
            {f.unit && <span className={cn("font-normal text-foreground/65", TEXT.note)}> {f.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
