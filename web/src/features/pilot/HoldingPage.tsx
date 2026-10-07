import { useId, useState } from "react";
import { cn } from "cn";
import FieldHit from "../../components/FieldHit";
import { ListGroup, ListRow } from "../../components/GroupedList";
import Segmented from "../../components/Segmented";
import { Input } from "../../components/ui/input";
import { approachRelative, holdingEntry, holdingWind, type Entry, type Turns } from "../../lib/holding";
import { heading } from "../../lib/workings";
import { TEXT } from "../../lib/text";

const ENTRY_NAME: Record<Entry, string> = { direct: "Direct", teardrop: "Teardrop", parallel: "Parallel" };

/** AIM 5-3-8's words for each entry, for the turns given. */
function entrySteps(entry: Entry, inbound: number, turns: Turns): string {
  const outbound = (inbound + 180) % 360;
  const away = turns === "right" ? "left" : "right";
  if (entry === "direct") return `Fly to the fix and turn ${turns} to follow the pattern: outbound on ${heading(outbound)}.`;
  if (entry === "teardrop") {
    const tear = turns === "right" ? outbound - 30 : outbound + 30;
    return `Fly to the fix, then turn to ${heading(tear)}, 30° into the holding side, for one minute; turn ${turns} to intercept the inbound course, ${heading(inbound)}.`;
  }
  return `At the fix, turn to ${heading(outbound)}, parallel to the holding course on the non-holding side, for one minute; then turn ${away}, toward the holding side, through more than 180° to intercept the inbound course or return to the fix.`;
}

/** A point `r` from the fix at a bearing `deg` measured on the page, up
 *  being the inbound course. */
function at(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/**
 * The hold drawn as a pilot pictures it: the inbound course up the page
 * to the fix, the racetrack on the holding side, the 70° line and the
 * holding course through the fix dividing the three sectors, the way the
 * airplane comes in, and the entry it flies, in the tint.
 */
function HoldDiagram({ inbound, headingTo, turns, entry }: { inbound: number; headingTo: number; turns: Turns; entry: Entry }) {
  const side = turns === "right" ? 1 : -1;
  const fx = 150, fy = 105, r = 32, len = 100;
  const ox = fx + side * 2 * r;
  const sweep = turns === "right" ? 1 : 0;
  const track = `M${fx} ${fy} A${r} ${r} 0 0 ${sweep} ${ox} ${fy} L${ox} ${fy + len} A${r} ${r} 0 0 ${sweep} ${fx} ${fy + len} Z`;
  const line70 = turns === "right" ? [110, 290] : [250, 70];
  const [l1x, l1y] = at(fx, fy, 150, line70[0]!), [l2x, l2y] = at(fx, fy, 150, line70[1]!);
  const labels: [Entry, number][] = turns === "right" ? [["parallel", 52], ["teardrop", 322], ["direct", 205]] : [["parallel", 308], ["teardrop", 38], ["direct", 155]];
  const from = approachRelative(inbound, headingTo);
  const [ax, ay] = at(fx, fy, 128, from), [bx, by] = at(fx, fy, 30, from);
  // Each entry's turn drawn as a curve that leaves in the direction the
  // leg before it was flown and meets the inbound course heading up it.
  let path = "";
  if (entry === "teardrop") {
    // 30° into the holding side for the minute, then the turn the
    // pattern's way, round to the inbound course.
    const out = 180 - side * 30;
    const [tx, ty] = at(fx, fy, len * 0.85, out);
    const [c1x, c1y] = at(tx, ty, 40, out);
    path = `M${fx} ${fy} L${tx} ${ty} C${c1x} ${c1y} ${fx} ${fy + len + 30} ${fx} ${fy + len * 0.5}`;
  } else if (entry === "parallel") {
    // Outbound on the non-holding side for the minute, then the turn
    // toward the holding side through more than 180°, onto the inbound
    // course.
    const px = fx - side * 20;
    path = `M${fx} ${fy} C${fx} ${fy + 15} ${px} ${fy + 10} ${px} ${fy + 35} L${px} ${fy + len} `
      + `C${px} ${fy + len + 45} ${fx + side * 40} ${fy + len + 40} ${fx} ${fy + len * 0.5}`;
  }
  const label = `${ENTRY_NAME[entry]} entry to a hold with ${turns} turns on an inbound course of ${heading(inbound)}, arriving on a heading of ${heading(headingTo)}.`;
  return (
    <svg viewBox="0 0 300 270" className="mx-auto h-auto w-full max-w-80 text-foreground leading-4" role="img" aria-label={label} data-testid="hold-diagram">
      <line x1={fx} y1={4} x2={fx} y2={266} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 4" />
      <line x1={l1x} y1={l1y} x2={l2x} y2={l2y} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 4" />
      <g className="text-muted-foreground" fill="currentColor" fontSize={12} textAnchor="middle">
        {labels.map(([name, deg]) => {
          const [x, y] = at(fx, fy, 92, deg);
          return <text key={name} x={x} y={y} fontWeight={name === entry ? 700 : 400}>{ENTRY_NAME[name]}</text>;
        })}
      </g>
      <path d={track} fill="none" stroke="currentColor" strokeOpacity={entry === "direct" ? 1 : 0.55} strokeWidth={entry === "direct" ? 2.5 : 1.5}
        className={entry === "direct" ? "text-tint" : undefined} />
      {path && <path d={path} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-tint" />}
      <path d={`M${fx - 6} ${fy + len - 30} L${fx} ${fy + len - 42} L${fx + 6} ${fy + len - 30}`} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5} />
      <circle cx={fx} cy={fy} r={5} fill="currentColor" />
      <text x={fx - side * 10} y={fy - 8} fontSize={12} textAnchor={turns === "right" ? "end" : "start"} fill="currentColor">Fix</text>
      <g className="text-tint">
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" strokeWidth={2} strokeDasharray="5 3" />
        <path d="M-5 4 L0 -3 L5 4" transform={`translate(${bx} ${by}) rotate(${from + 180})`} fill="none" stroke="currentColor" strokeWidth={2} />
      </g>
    </svg>
  );
}

function NumberRow({ id, title, value, onChange, unit, testId }: {
  id: string; title: string; value: string; onChange: (v: string) => void; unit: string; testId: string;
}) {
  return (
    <ListRow id={id} title={title}>
      <span className="flex items-center gap-1.5">
        <FieldHit htmlFor={id}>
          <Input id={id} inputMode="numeric" className="h-8 w-20 text-right tabular-nums" value={value} onChange={e => onChange(e.target.value)} data-testid={testId} />
        </FieldHit>
        <span className={cn("w-7 text-muted-foreground", TEXT.detail)}>{unit}</span>
      </span>
    </ListRow>
  );
}

/**
 * The holding page (ACS IR.III.B): a hold's inbound course and turns and
 * the heading the airplane arrives on, its entry by AIM 5-3-8 drawn and
 * said, and -- given a true airspeed and a wind -- the headings and the
 * outbound time that make the inbound leg a minute.
 */
export default function HoldingPage() {
  const id = useId();
  const [inbound, setInbound] = useState("360");
  const [headingTo, setHeadingTo] = useState("220");
  const [turns, setTurns] = useState<Turns>("right");
  const [tas, setTas] = useState("100");
  const [windFrom, setWindFrom] = useState("300");
  const [windKt, setWindKt] = useState("15");
  const [altitude, setAltitude] = useState("5000");
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const i = num(inbound), h = num(headingTo);
  const valid = Number.isFinite(i) && Number.isFinite(h);
  const found = valid ? holdingEntry(i, h, turns) : null;
  const wind = valid && [tas, windFrom, windKt, altitude].every(v => Number.isFinite(num(v)))
    ? holdingWind(i, num(tas), num(windFrom), num(windKt), num(altitude)) : null;
  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(0)}°`;

  return (
    <div className="space-y-4">
      <ListGroup title="The hold">
        <NumberRow id={`${id}-in`} title="Inbound course" value={inbound} onChange={setInbound} unit="°" testId="hold-inbound" />
        <ListRow title="Turns">
          <Segmented label="Turns" value={turns} onChange={v => setTurns(v as Turns)} testId="hold-turns"
            options={[{ value: "right", label: "Right" }, { value: "left", label: "Left" }]} />
        </ListRow>
        <NumberRow id={`${id}-hdg`} title="Your heading to the fix" value={headingTo} onChange={setHeadingTo} unit="°" testId="hold-heading" />
      </ListGroup>

      {found && (
        <>
          <HoldDiagram inbound={i} headingTo={h} turns={turns} entry={found.entry} />
          <ListGroup
            footer={found.either ? `Within 5° of the line between two sectors: the AIM lets you fly either, ${ENTRY_NAME[found.entry].toLowerCase()} or ${ENTRY_NAME[found.either].toLowerCase()}.` : "AIM 5-3-8's three sectors, divided by the holding course and the 70° line on the holding side."}
          >
            <ListRow title={<span className="font-semibold">{ENTRY_NAME[found.entry]} entry</span>} description={entrySteps(found.entry, i, turns)} data-testid="hold-entry" />
          </ListGroup>
        </>
      )}

      <ListGroup title="In the wind" footer="The course and the wind in the same reference: magnetic, as a clearance gives the course (winds aloft are true). Turns at standard rate.">
        <NumberRow id={`${id}-tas`} title="True airspeed" value={tas} onChange={setTas} unit="kt" testId="hold-tas" />
        <NumberRow id={`${id}-wd`} title="Wind from" value={windFrom} onChange={setWindFrom} unit="°" testId="hold-wind-from" />
        <NumberRow id={`${id}-ws`} title="Wind speed" value={windKt} onChange={setWindKt} unit="kt" testId="hold-wind-kt" />
        <NumberRow id={`${id}-alt`} title="Altitude" value={altitude} onChange={setAltitude} unit="ft" testId="hold-altitude" />
      </ListGroup>
      {wind ? (
        <ListGroup footer={`An inbound leg of ${wind.legMin === 1 ? "a minute" : "a minute and a half"}, at or below 14,000 ft MSL a minute (AIM 5-3-8); outbound timing from over or abeam the fix, whichever is later.`}>
          <ListRow title="Inbound heading" description={`${signed(wind.inbound.wca)} for the wind, ${Math.round(wind.inbound.gs)} kt over the ground`} value={heading(wind.inbound.heading)} data-testid="hold-in-heading" />
          <ListRow title="Outbound heading" description={`Three times the inbound correction, ${signed(wind.outbound.wca)}, the turns' drift taken up too`} value={heading(wind.outbound.heading)} data-testid="hold-out-heading" />
          <ListRow
            title="Outbound time"
            description={`So the inbound leg takes ${wind.legMin === 1 ? "a minute" : "a minute and a half"} at ${Math.round(wind.inbound.gs)} kt; by the rule of a second a knot, ${Math.round(wind.ruleSec)} s`}
            value={`${Math.round(wind.outboundSec)} s`} data-testid="hold-out-time"
          />
        </ListGroup>
      ) : (
        <p className={cn("px-1 text-muted-foreground", TEXT.prose)}>A wind stronger than the airplane holds no heading.</p>
      )}
    </div>
  );
}
