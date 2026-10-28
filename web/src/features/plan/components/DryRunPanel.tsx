import { Suspense, lazy, memo, useMemo, useRef, type ComponentProps, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import { Slider } from "../../../components/ui/slider";
import { REPLAY_SPEEDS, pausePastFlight, playPastFlight, positionAt, usePastFlight } from "../../../lib/map/pastFlight";
import { routeProfileQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import FlightLine from "./FlightLine";
import { dryRunFlown, runNmAt, type DryRun, type Flown } from "./navlog/dryRun";
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
  // and going on as it was once let go; the arrow keys step it five miles.
  // shadcn's Slider (Radix's) over the chart, its track and thumb unseen:
  // the chart's own marks say where the run is. Across the chart's own
  // width, inside its twelve points each side (PastFlightChart), a tenth
  // of a mile a step for the finger.
  const held = useRef<{ was: boolean } | null>(null);
  const first = run.alongNm[0] ?? 0, last = run.alongNm.at(-1) ?? 0;
  const nowNm = second === null ? null : alongAt(run, second);
  const seekNm = (nm: number) => usePastFlight.setState({ at: timeAt(run, Math.min(last, Math.max(first, nm))) });
  // Before the slider's own: the run held, then put where the finger is.
  const grab = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    held.current = { was: usePastFlight.getState().playing };
    pausePastFlight();
  };
  const letGo = () => {
    if (held.current?.was) playPastFlight();
    held.current = null;
  };
  // Five miles an arrow, where the slider's own would step a tenth; Home
  // and End are the slider's.
  const step = (event: KeyboardEvent<HTMLSpanElement>) => {
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
            the tabs' swipe (a slider, TabBar). The ring round the chart
            while its thumb has the keyboard's focus. */}
        <Slider
          min={tenth(first)} max={Math.max(tenth(last), tenth(first) + 0.1)} step={0.1}
          value={[tenth(nowNm ?? first)]}
          // The scrubber's end is the run's end: its last tenth of a mile,
          // sought as such, came back a hundredth short through the run's
          // own time and read a tenth under the end (End pressed:
          // dry-run.spec, CI on both projects).
          onValueChange={([nm]) => { if (nm !== undefined) seekNm(nm >= tenth(last) ? last : nm); }}
          onPointerDown={grab} onPointerUp={letGo} onPointerCancel={letGo} onKeyDown={step}
          className={cn(
            "absolute inset-y-0 right-3 left-3 w-auto cursor-ew-resize rounded-lg",
            "has-[[data-slot=slider-thumb]:focus-visible]:ring-2 has-[[data-slot=slider-thumb]:focus-visible]:ring-ring",
            "[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent",
          )}
          thumb={{
            "aria-label": "Where the dry run is along the course",
            "aria-valuetext": nowNm === null ? undefined : `${Math.round(nowNm)} nm${here ? `, ${altFt(here.alt_ft)} feet, ${here.gs_kt != null ? `${Math.round(here.gs_kt)} knots` : "no ground speed"}` : ""}`,
            className: "opacity-0",
          }}
          data-testid="dry-run-scrub"
        />
      </div>
    </div>
  );
}

/** To the tenth of a mile, the scrubber's step. */
const tenth = (nm: number) => Math.round(nm * 10) / 10;

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
  // As far as the figures say it -- a tenth of a mile and of a gallon, a
  // minute -- so the strip is drawn again only when one changes, not at
  // each of the run's frames: it measures its figures to fit them
  // (useFigureFit), and the map's own frames came second to it.
  const key = usePastFlight(s => {
    const flown = dryRunFlown(run, s.at ?? run.points[0]?.t ?? 0);
    if (!flown) return "";
    const { hop, now, next, last, burntGal } = flown;
    return [hop, Math.floor(now / 60) * 60, next.nm.toFixed(1), Math.round(next.min), last.nm.toFixed(1), Math.round(last.min), burntGal.toFixed(1)].join(" ");
  });
  const flown = useMemo((): Flown | null => {
    if (!key) return null;
    const [hop, now, nextNm, nextMin, lastNm, lastMin, burnt] = key.split(" ").map(Number) as [number, number, number, number, number, number, number];
    return {
      hop, now, burntGal: burnt,
      next: { nm: nextNm, min: nextMin, at: now + nextMin * 60 }, last: { nm: lastNm, min: lastMin, at: now + lastMin * 60 },
    };
  }, [key]);
  return (
    <div data-testid="dry-run-figures">
      <SteadyLine {...line} flown={flown} grow />
    </div>
  );
}

/** The flight's figures drawn again only for new ones (DryRunFigures). */
const SteadyLine = memo(FlightLine);
