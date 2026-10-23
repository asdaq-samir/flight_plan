import { Fragment } from "react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Briefing, Leg } from "../../../../lib/api/types";
import { compassWord, entryFor, exitFor, patternSideDeg, runwayNumber, type RunwayEnd } from "../../../../lib/pattern";
import { fieldPhases, type RadioCall, type RadioPhase } from "../../../../lib/radio";
import { useRunwayPicks } from "../../../../lib/useRunwayPicks";
import { altFt } from "../../format";
import { Mhz } from "../FrequencyRow";

type Facilities = Briefing["airports"][string];

/** A chevron at (x, y) pointing `deg` clockwise from up: the way the
 *  pattern is flown there. */
function Chevron({ x, y, deg }: { x: number; y: number; deg: number }) {
  return <path d="M-4 3 L0 -2 L4 3" transform={`translate(${x} ${y}) rotate(${deg})`} fill="none" stroke="currentColor" strokeWidth={1.5} />;
}

/**
 * The pattern for one runway end drawn as a pilot pictures it, the
 * runway up the page and landed on from the bottom: the circuit on its
 * side with the way it is flown, the 45° entry to the downwind abeam
 * midfield in the tint, which way north is, and -- arriving -- the way
 * the route comes in.
 */
function PatternDiagram({ end, opposite, fromDeg }: { end: RunwayEnd; opposite: string | null; fromDeg: number | null }) {
  const right = end.traffic === "right";
  const side = right ? 1 : -1;
  const xd = 120 + side * 60;
  const heading = end.heading_true_deg ?? 0;
  const across = (120 + xd) / 2;
  const rel = fromDeg == null ? null : ((fromDeg - heading) * Math.PI) / 180;
  const label = `${end.traffic === "right" ? "Right" : "Left"} traffic for runway ${runwayNumber(end.ident)}: the downwind ${compassWord(patternSideDeg(end))} of the runway, joined on the 45 abeam midfield.`;
  return (
    // Its labels at 12 in a 240-wide drawing never drawn wider than 240
    // (max-w-60): 12 points or more on the screen, over the 11 HIG's
    // smallest -- a diagram's labels, outside the type scale on purpose.
    <svg viewBox="0 0 240 240" className="mx-auto h-auto w-full max-w-60 text-foreground" role="img" aria-label={label} data-testid="pattern-diagram">
      <g className="text-xs text-muted-foreground" fill="currentColor" textAnchor="middle">
        <text x={xd + side * 12} y={150} transform={`rotate(${-90 * side} ${xd + side * 12} 150)`}>Downwind</text>
        <text x={across} y={214}>Base</text>
        <text x={120 - side * 8} y={190} textAnchor={right ? "end" : "start"}>Final</text>
      </g>
      <path d={`M120 80 V40 H${xd} V200 H120 V160`} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} />
      <g className="text-muted-foreground">
        <Chevron x={120} y={60} deg={0} />
        <Chevron x={across} y={40} deg={90 * side} />
        <Chevron x={xd} y={170} deg={180} />
        <Chevron x={across} y={200} deg={-90 * side} />
        <Chevron x={120} y={182} deg={0} />
      </g>
      {/* The runway with its numbers painted at its ends, as it is:
          each read from its own approach. */}
      <rect x={110} y={80} width={20} height={80} rx={1.5} fill="currentColor" />
      <g className="fill-background text-xs" fontWeight={700} textAnchor="middle">
        <text x={120} y={155}>{runwayNumber(end.ident)}</text>
        {opposite && <text x={120} y={155} transform="rotate(180 120 120)">{runwayNumber(opposite)}</text>}
      </g>
      <g className="text-tint">
        <path d={`M${xd + side * 50} 70 L${xd} 120`} stroke="currentColor" strokeWidth={2} fill="none" />
        <Chevron x={xd + side * 6} y={114} deg={right ? 225 : 135} />
        <text x={right ? 236 : 4} y={62} className="text-xs" textAnchor={right ? "end" : "start"} fill="currentColor">45° entry</text>
      </g>
      {/* North, turned to the runway: the page's up is its heading. */}
      <g transform={`translate(${120 - side * 96} 26) rotate(${-heading})`} className="text-muted-foreground">
        <path d="M0 -11 L4 5 L0 2 L-4 5 Z" fill="currentColor" />
        <text y={-14} className="text-xs" textAnchor="middle" fill="currentColor" transform={`rotate(${heading} 0 -17)`}>N</text>
      </g>
      {rel != null && (
        <g className="text-tint" data-testid="pattern-arrival">
          <path
            d={`M${120 + 116 * Math.sin(rel)} ${120 - 116 * Math.cos(rel)} L${120 + 98 * Math.sin(rel)} ${120 - 98 * Math.cos(rel)}`}
            stroke="currentColor" strokeWidth={2} strokeDasharray="3 2"
          />
          <Chevron x={120 + 98 * Math.sin(rel)} y={120 - 98 * Math.cos(rel)} deg={(rel * 180) / Math.PI + 180} />
          <text
            x={120 + 107 * Math.sin(rel) + 12 * Math.cos(rel)} y={120 - 107 * Math.cos(rel) + 12 * Math.sin(rel) + 3}
            className="text-xs" textAnchor="middle" fill="currentColor"
          >
            You
          </text>
        </g>
      )}
    </svg>
  );
}

/** A call's words, the pilot's blanks ("[letter]") set apart. */
function Words({ words }: { words: string }) {
  return (
    <>
      {words.split(/(\[[^\]]+\])/).map((part, i) => (
        part.startsWith("[")
          ? <span key={i} className="text-muted-foreground italic">{part}</span>
          : <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}

function CallRow({ call }: { call: RadioCall }) {
  return (
    <ListRow
      title={call.listen ? `Listen: ${call.to}` : call.to}
      description={(
        <>
          <span className={cn("block", !call.listen && "text-foreground")}>{call.listen ? call.words : <>“<Words words={call.words} />”</>}</span>
          {call.note && <span className="block pt-0.5">{call.note}</span>}
        </>
      )}
      value={call.mhz != null ? <Mhz mhz={call.mhz} /> : undefined}
      data-testid="radio-call"
    />
  );
}

/** One field's pattern: how high, the runway the wind favours and its
 *  side, the other ends flown right, and how to join it or leave it. */
function PatternRows({ phase, facilities, courseDeg }: { phase: RadioPhase; facilities: Facilities; courseDeg: number | null }) {
  const end = phase.end;
  const pattern = facilities.pattern;
  const runway = facilities.runways.find(r => r.runway_ends?.some(e => e.ident === end?.ident));
  const opposite = runway?.runway_ends?.find(e => e.ident !== end?.ident)?.ident ?? null;
  const rightEnds = facilities.runways.flatMap(r => r.runway_ends ?? []).filter(e => e.traffic === "right" && e.ident !== end?.ident);
  const entry = end && phase.kind === "arrival" && courseDeg != null ? entryFor(end, courseDeg) : null;
  return (
    // At a towered field the tower gives the runway and the pattern, either side.
    <ListGroup title={phase.title}>
      {end && (
        <div className="px-3 py-2">
          <PatternDiagram end={end} opposite={opposite} fromDeg={entry ? (courseDeg! + 180) % 360 : null} />
        </div>
      )}
      {pattern && (
        <ListRow
          title="Pattern altitude"
          description={pattern.published
            ? `${altFt(pattern.agl_ft)} ft above the field, as the FAA publishes it`
            : `${altFt(pattern.agl_ft)} ft above the field: none published, so AC 90-66C's for a propeller airplane`}
          value={pattern.altitude_ft != null ? `${altFt(pattern.altitude_ft)} ft` : undefined}
          data-testid="pattern-altitude"
        />
      )}
      {/* Which runway and why is the takeoff's or landing's to say
          (TakeoffLandingSection): here, which side its pattern is on. */}
      {end ? (
        <ListRow title={`Runway ${runwayNumber(end.ident)} · ${end.traffic} traffic`} data-testid="pattern-runway" />
      ) : (
        <ListRow muted title="No runway with a heading to draw" />
      )}
      {rightEnds.length > 0 && (
        <ListRow title="Right traffic too" value={rightEnds.map(e => runwayNumber(e.ident)).join(", ")} description="The other runway ends the FAA flies right; the rest left" />
      )}
      {entry && <ListRow title="Joining" description={entry.words} data-testid="pattern-entry" />}
      {end && phase.kind === "departure" && <ListRow title="Leaving" description={exitFor(end)} />}
    </ListGroup>
  );
}

/**
 * The pattern and the radio calls at one field (the roadmap's pattern
 * card and radio scripts, ACS PA.III.A and B), in the Brief's section
 * for it: leaving it or arriving -- both at a stop -- its pattern
 * drawn for the runway the wind favours, then the calls in the order they
 * are made (lib/radio), worked out over the whole route so each field's
 * calls know the next. Nothing for a local flight: there is no route to
 * call along.
 */
export default function PatternRadio({ briefing, landings, legs, callSign, at }: {
  briefing: Briefing;
  landings: string[];
  legs: Leg[];
  callSign: string;
  /** The field whose calls these are. */
  at: string;
}) {
  const picks = useRunwayPicks();
  const phases = fieldPhases(briefing, landings, legs, callSign, at, picks);
  if (!phases.length) return null;
  const courseInto = (ident: string) => {
    const into = legs.filter(l => l.to === ident);
    return into.length ? into[into.length - 1]!.true_course_deg : null;
  };
  return (
    <>
      {phases.map((phase, i) => (
        <div key={`${phase.kind}${i}`} className="space-y-2" data-testid="radio-phase">
          <PatternRows phase={phase} facilities={briefing.airports[phase.ident]!} courseDeg={phase.kind === "arrival" ? courseInto(phase.ident) : null} />
          <ListGroup>
            {phase.calls.map((call, j) => <CallRow key={j} call={call} />)}
          </ListGroup>
        </div>
      ))}
    </>
  );
}

// The calls are worded as the AIM (4-1-9, 4-2) and AC 90-66C word them,
// figures as they are spoken, the words in brackets the pilot's to fill in:
// said here, where it was a footnote under every field's calls.
