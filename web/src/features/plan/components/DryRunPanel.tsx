import { Suspense, lazy, useRef, type ComponentProps, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import { REPLAY_SPEEDS, pausePastFlight, playPastFlight, positionAt, usePastFlight } from "../../../lib/map/pastFlight";
import { routeProfileQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import FlightLine from "./FlightLine";
import { dryRunFlown, runNmAt, type DryRun } from "./navlog/dryRun";
import type { RouteEnds } from "./navlog/rows";
import { loadFlightChart } from "./loadFlightChart";

const FlightChart = lazy(loadFlightChart);

/**
 * The planned flight flown on paper, at the owner's ask ("a dry run of the
 * flight with altitude and speed profile as well as the calculations at
 * the bottom"): its height and ground speed across the flight, the moment
 * marked and said over it, its controls on it -- from the start again,
 * play or pause, how fast, and the close (a past flight's replay's chart,
 * PastFlightChart), the airplane flown along the course on the map
 * (DryRunLayer). In FPL's foot in the side view's place, the flight's
 * figures under it as it goes (DryRunFigures); the chart growing with the
 * sheet.
 */
export function DryRunControls({ run, ends, onClose, missed = false, onMissed }: {
  run: DryRun;
  ends: RouteEnds | null;
  onClose: () => void;
  /** The approach picked goes missed (dryRunOf's `missed`), and the button
   *  that sends it, on the approach's final (`run.final`). */
  missed?: boolean;
  onMissed?: () => void;
}) {
  const playing = usePastFlight(s => s.playing);
  // The airspace the course passes through, the side view's answer
  // (routeProfileQuery): it was drawn there before the run's play.
  const { data: profile } = useQuery({
    ...routeProfileQuery(ends?.departure.ident ?? "", ends?.destination.ident ?? "", (ends?.stops ?? []).map(s => s.ident)),
    enabled: !!ends,
  });
  const speed = usePastFlight(s => s.speed);
  const second = usePastFlight(s => (s.at === null ? null : Math.floor(s.at)));
  const here = second === null ? null : positionAt(run.points, second);
  // On the approach's final, not gone missed yet: the moment to go missed,
  // at the owner's ask ("just show a go missed button when on the final of
  // the approach").
  const onFinal = !!run.final && !missed && !!onMissed && second !== null && second >= run.final.from && second < run.final.to;
  // The speeds in turn, a tap each: one small button on the chart, where
  // a segmented control took a row of its own.
  const nextSpeed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number]) + 1) % REPLAY_SPEEDS.length]!;
  // The chart dragged along, at the owner's ask ("can the trace be
  // drag-able in the dry run?"): a finger or a pointer on it puts the
  // airplane where it points along the course, the run held while it does
  // and going on as it was once let go; the arrow keys step it five miles,
  // as a slider's do. Across the chart's own width, inside its twelve
  // points each side (PastFlightChart).
  const box = useRef<HTMLDivElement>(null);
  const held = useRef<{ was: boolean } | null>(null);
  const first = run.alongNm[0] ?? 0, last = run.alongNm.at(-1) ?? 0;
  const nowNm = second === null ? null : alongAt(run, second);
  const seekNm = (nm: number) => usePastFlight.setState({ at: timeAt(run, Math.min(last, Math.max(first, nm))) });
  const seek = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    seekNm(first + Math.min(1, Math.max(0, (clientX - r.left - 12) / Math.max(1, r.width - 24))) * (last - first));
  };
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = { was: usePastFlight.getState().playing };
    pausePastFlight();
    seek(event.clientX);
  };
  const letGo = () => {
    if (held.current?.was) playPastFlight();
    held.current = null;
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowRight" || event.key === "ArrowUp" ? 5 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -5 : 0;
    if (!by) return;
    event.preventDefault();
    seekNm((nowNm ?? first) + by);
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-xl bg-background/70 px-1 pt-1" data-testid="dry-run">
      {/* Its controls on the chart, at its top right, where the side view's
          play is, at the owner's ask ("can the control buttons for the dry
          run be on the profile graph just like the play button"): from the
          start, play or pause, how fast, and the close. Eight apart, their
          44-point hit areas their own (index.css). */}
      {/* Over the chart's drag where their hit areas reach into it. */}
      <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-2">
        {/* No from the start, at the owner's ask ("I don't think we need the
            replay button"): the chart's drag takes the run back. Go missed
            on the approach's final only (above). */}
        {onFinal && (
          <RoundButton
            label="Go missed" onClick={onMissed} className={cn("w-auto px-2.5 font-semibold", TEXT.note)}
            data-testid="dry-run-missed"
          >
            Go missed
          </RoundButton>
        )}
        <RoundButton label={playing ? "Pause" : "Play"} onClick={playing ? pausePastFlight : playPastFlight} data-testid="dry-run-play">
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </RoundButton>
        <RoundButton
          label={`${speed} times as fast; ${nextSpeed} times next`} onClick={() => usePastFlight.setState({ speed: nextSpeed })}
          className={cn("w-auto px-2 font-semibold tabular-nums", TEXT.note)} data-testid="dry-run-speed"
        >
          {speed}×
        </RoundButton>
        <CloseButton onClick={onClose} data-testid="dry-run-close" />
      </div>
      {/* The height and speed are said on the traces themselves (the
          chart's NowMarks), where a line of words over the chart took a
          row of its own: the controls over the chart's corner as the side
          view's play is, at the owner's ask ("Dry run buttons can overlay
          the chart like profile view does"). */}
      {/* Six rem, and what the side view's place leaves it, three at the
          least: a flex size the chart is drawn to -- a min-height alone left
          it none all the way up, and the chart blank (the owner's
          recording). */}
      <div className="relative min-h-12 flex-[1_1_6rem]">
        {/* Drawn to the box's own size, whatever the flex gave it: WebKit
            gives a grown flex item's child no height of its own to be a
            share of, and the chart stayed three rem tall all the way up. */}
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <FlightChart
              points={run.points} at={second ?? run.points[0]?.t ?? null} alongNm={run.alongNm} airspace={profile}
              laid={fraction => runNmAt(run, fraction * (run.bends.at(-1)?.route ?? 0))}
            />
          </Suspense>
        </div>
        {/* Over the chart, its own drag: not the sheet's (touch-none) nor
            the tabs' swipe (a slider). */}
        <div
          ref={box} role="slider" tabIndex={0} aria-label="Where the dry run is along the course"
          aria-valuemin={Math.round(first)} aria-valuemax={Math.round(last)} aria-valuenow={nowNm === null ? undefined : Math.round(nowNm)}
          aria-valuetext={nowNm === null ? undefined : `${Math.round(nowNm)} nm${here ? `, ${altFt(here.alt_ft)} feet, ${here.gs_kt != null ? `${Math.round(here.gs_kt)} knots` : "no ground speed"}` : ""}`}
          className="absolute inset-0 cursor-ew-resize touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={grab} onPointerMove={event => { if (held.current) seek(event.clientX); }}
          onPointerUp={letGo} onPointerCancel={letGo} onKeyDown={step}
          data-testid="dry-run-scrub"
        />
      </div>
    </div>
  );
}

/** How far along the course the dry run is at `t`, nm. */
function alongAt(run: DryRun, t: number): number {
  const { points, alongNm } = run;
  if (!points.length) return 0;
  if (t <= points[0]!.t) return alongNm[0]!;
  const i = points.findIndex(p => p.t >= t);
  if (i < 0) return alongNm.at(-1)!;
  const a = points[i - 1]!, b = points[i]!;
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return alongNm[i - 1]! + (alongNm[i]! - alongNm[i - 1]!) * f;
}

/** When the dry run is `nm` along the course. */
function timeAt(run: DryRun, nm: number): number {
  const { points, alongNm } = run;
  if (!points.length) return 0;
  if (nm <= alongNm[0]!) return points[0]!.t;
  const i = alongNm.findIndex(a => a >= nm);
  if (i < 0) return points.at(-1)!.t;
  const a = alongNm[i - 1]!, b = alongNm[i]!;
  const f = b > a ? (nm - a) / (b - a) : 0;
  return points[i - 1]!.t + (points[i]!.t - points[i - 1]!.t) * f;
}

/** The flight's own figures as the dry run goes, in their place at the
 *  panel's foot, at the owner's ask ("Dry run should keep the calculations
 *  as in the profile"): To, Dist, ETE or ETA and Fuel, the same taps on
 *  them, from where the airplane is -- the next landing ahead, the
 *  distance and time left to it, and the fuel required less what the run
 *  has burnt. They had been figures of their own (Dist left, Time left,
 *  ETA, To burn). */
export function DryRunFigures({ run, ...line }: { run: DryRun } & Omit<ComponentProps<typeof FlightLine>, "flown" | "grow">) {
  const at = usePastFlight(s => s.at);
  const flown = dryRunFlown(run, at ?? run.points[0]?.t ?? 0);
  return (
    <div data-testid="dry-run-figures">
      <FlightLine {...line} flown={flown} grow />
    </div>
  );
}
