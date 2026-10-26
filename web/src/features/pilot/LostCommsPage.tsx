// The page's words are also the planner's (app/figures/lost_comms.py, for the native app): the two change together.
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "cn";
import FieldHit from "../../components/FieldHit";
import { ListGroup, ListRow } from "../../components/GroupedList";
import Segmented from "../../components/Segmented";
import { Input } from "../../components/ui/input";
import TogglePill from "../../components/TogglePill";
import { leaveLimit, ROUTES, segmentAltitudes, type RouteKey, type Segment } from "../../lib/lostComms";
import { TEXT } from "../../lib/text";
import { altFt } from "../../lib/units";
import { RemoveMinus } from "../../components/Favorites";

const BECAUSE = { assigned: "assigned", minimum: "the minimum", expected: "expected" } as const;

/** A route to start from, made up: a clearance to 4,000, expecting 6,000
 *  from the second segment on, over an MEA of 5,000 there. */
const EXAMPLE: Segment[] = [
  { name: "Departure to SWEDE", minimumFt: 2600 },
  { name: "SWEDE to RAYMO", minimumFt: 5000 },
  { name: "RAYMO to the approach fix", minimumFt: 3400 },
];

const feet = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The lost-comms page (14 CFR 91.185, ACS IR.VII.A): which route to fly,
 * by the rule's order; the altitude on each segment, the highest of
 * assigned, minimum and expected; and when to leave the clearance limit.
 * It opens on a made-up route, marked so, for the pilot's own.
 */
export default function LostCommsPage() {
  const id = useId();
  const [route, setRoute] = useState<RouteKey>("assigned");
  const [segments, setSegments] = useState(EXAMPLE.map(s => ({ name: s.name, minimum: String(s.minimumFt) })));
  const [assigned, setAssigned] = useState("4000");
  const [expected, setExpected] = useState("6000");
  const [expectedFrom, setExpectedFrom] = useState(1);
  const [approachFix, setApproachFix] = useState(false);
  const [efc, setEfc] = useState("");
  const [eta, setEta] = useState("1435Z");
  const flown = segmentAltitudes(
    segments.map(s => ({ name: s.name || "Segment", minimumFt: feet(s.minimum) })),
    { assignedFt: feet(assigned), expectedFt: feet(expected), expectedFrom },
  );
  const edit = (i: number, patch: Partial<{ name: string; minimum: string }>) =>
    setSegments(list => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-4">
      <p className={cn(TEXT.prose)}>
        In VFR conditions, or on meeting them after the failure: continue VFR and land as soon as practicable (91.185(b)).
        In IFR conditions, the rest of this page.
      </p>

      <ListGroup title="Route">
        <ListRow title="Which applies first">
          <Segmented label="Route" value={route} onChange={v => setRoute(v as RouteKey)} testId="lost-route"
            options={ROUTES.map(r => ({ value: r.key, label: r.label }))} />
        </ListRow>
        {/* The rule for the route picked, a row of its own: it was a footnote. */}
        <ListRow title={<span className={TEXT.detail}>{ROUTES.find(r => r.key === route)!.rule}</span>} data-testid="lost-route-rule" />
      </ListGroup>

      <ListGroup title="The clearance">
        <ListRow id={`${id}-assigned`} title="Assigned">
          <FieldHit htmlFor={`${id}-assigned`}>
            <Input id={`${id}-assigned`} inputMode="numeric" className="h-8 w-24 text-right tabular-nums" value={assigned} onChange={e => setAssigned(e.target.value)} data-testid="lost-assigned" />
          </FieldHit>
        </ListRow>
        <ListRow id={`${id}-expected`} title="Expect" description={`From ${segments[expectedFrom]?.name || "the segment chosen below"} on`}>
          <FieldHit htmlFor={`${id}-expected`}>
            <Input id={`${id}-expected`} inputMode="numeric" className="h-8 w-24 text-right tabular-nums" value={expected} onChange={e => setExpected(e.target.value)} data-testid="lost-expected" />
          </FieldHit>
        </ListRow>
      </ListGroup>

      {/* Each segment's minimum for IFR operations: its MEA, or the OROCA
          or MOCA off airways. */}
      <ListGroup title="The route's segments">
        {/* Each segment two rows: its name and minimum, then what is flown
            on it, a tap saying the expected altitude applies from there. The
            altitude was a line under the name, and its tap area reached into
            the name field's (the iOS audit, 2026-10-14). */}
        {segments.flatMap((s, i) => {
          const f = flown[i]!;
          return [
            <ListRow
              key={`seg-${i}`}
              // The app's one minus (RemoveMinus), where this was a hollow one of
              // its own; a segment of a form, taken away at its tap. The last
              // segment keeps no minus: a route has one at least.
              media={segments.length > 1 ? (
                <RemoveMinus
                  label={`Remove ${s.name || "this segment"}`}
                  onClick={() => { setSegments(list => list.filter((_, j) => j !== i)); setExpectedFrom(e => Math.max(0, Math.min(e, segments.length - 2))); }}
                />
              ) : undefined}
              title={<FieldHit htmlFor={`${id}-seg${i}`}><Input id={`${id}-seg${i}`} aria-label="Segment" className="h-8" value={s.name} onChange={e => edit(i, { name: e.target.value })} /></FieldHit>}
              data-testid="lost-segment"
            >
              <FieldHit htmlFor={`${id}-min${i}`}>
                <Input id={`${id}-min${i}`} aria-label={`${s.name || "Segment"}'s minimum altitude`} inputMode="numeric" className="h-8 w-20 text-right tabular-nums"
                  value={s.minimum} onChange={e => edit(i, { minimum: e.target.value })} />
              </FieldHit>
            </ListRow>,
            <ListRow
              key={`fly-${i}`}
              title={<span className={i >= expectedFrom ? "text-foreground" : "text-tint"}>{f.fly == null ? "No altitude known" : `Fly ${altFt(f.fly)} ft: ${BECAUSE[f.because!]}`}</span>}
              onClick={() => setExpectedFrom(i)} data-testid="lost-segment-fly"
            />,
          ];
        })}
        <ListRow title="Add a segment" media={<Plus className="size-5" aria-hidden />} onClick={() => setSegments(list => [...list, { name: "", minimum: "" }])} data-testid="lost-add" />
      </ListGroup>

      <ListGroup title="Leaving the clearance limit">
        <ListRow title="The limit is a fix an approach begins from">
          <TogglePill pressed={approachFix} onPressedChange={setApproachFix} label={approachFix ? "Yes" : "No"} testId="lost-approach-fix" />
        </ListRow>
        <ListRow id={`${id}-efc`} title="Expect further clearance" description="Blank where none was given">
          <FieldHit htmlFor={`${id}-efc`}>
            <Input id={`${id}-efc`} className="h-8 w-24 text-right tabular-nums" placeholder="—" value={efc} onChange={e => setEfc(e.target.value)} data-testid="lost-efc" />
          </FieldHit>
        </ListRow>
        <ListRow id={`${id}-eta`} title="Your ETA" description="From the filed or amended time en route">
          <FieldHit htmlFor={`${id}-eta`}>
            <Input id={`${id}-eta`} className="h-8 w-24 text-right tabular-nums" value={eta} onChange={e => setEta(e.target.value)} />
          </FieldHit>
        </ListRow>
        <ListRow title={<span className="font-normal" data-testid="lost-leave">{leaveLimit(approachFix, efc.trim(), eta.trim())}</span>} />
      </ListGroup>
      {/* 14 CFR 91.185(c): the route by the first of assigned, vectored,
          expected and filed; on each segment, the highest of the altitude
          assigned, the minimum for IFR operations and the altitude ATC said
          to expect. */}
    </div>
  );
}
