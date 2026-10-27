import { useState } from "react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import PullDown from "../../../components/PullDown";
import Segmented from "../../../components/Segmented";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { lengthCode, lengthOfCode, lengthWords, type Hold } from "../../../lib/holds";
import { legMinutes } from "../../../lib/holding";
import { bearing } from "../../../lib/units";
import { TEXT } from "../../../lib/text";

/** The point a hold is being set at: its ident, the hold there now, the
 *  magnetic course flown to it, and the altitude it is reached at. */
export interface HoldAt {
  fix: string;
  hold: Hold | null;
  arrivalDeg: number | null;
  altitudeFt: number | null;
}

/** Its legs' choices: minutes, or nm. */
const LEG_MIN = [1, 1.5, 2, 3];
const LEG_NM = [2, 3, 4, 5, 10];
/** How long it is held: turns round it, or minutes. */
const LENGTHS = ["1T", "2T", "3T", "4T", "10M", "15M", "20M", "30M"];

/**
 * A hold at a point of the route, set as Garmin's and ForeFlight's
 * pilot-defined holds are, at the owner's ask ("create a left/right
 * hold", mock 4 of the canvas's holds): the course, inbound or outbound;
 * the turns, right (the standard pattern) or left; the legs by time --
 * a minute at or below 14,000 ft, a minute and a half above (lib/holding's
 * legMinutes) -- or distance; and how long, in turns or minutes. The planner works
 * out the entry from the course flown to it, and adds the hold's time
 * and fuel to the flight's (plan.with_holds). A card in the map's panel
 * on a phone, its title on top and Close, as the fix's card is.
 */
export default function HoldSheet({ at, onClose, onSet }: {
  at: HoldAt | null;
  onClose: () => void;
  onSet: (fix: string, hold: Hold | null) => void;
}) {
  return (
    <ResponsivePopover open={!!at} onOpenChange={next => { if (!next) onClose(); }}>
      <ResponsivePopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none fixed top-16 left-1/2 size-0" /></ResponsivePopoverAnchor>
      <ResponsivePopoverContent
        title={at ? `Hold at ${at.fix}` : "Hold"} side="bottom" align="center"
        className="flex w-80 flex-col gap-3 p-3" data-testid="hold-sheet"
        action={<CloseButton onClick={onClose} data-testid="hold-close" />}
      >
        {at && <HoldForm key={at.fix} at={at} onSet={onSet} />}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

function HoldForm({ at, onSet }: { at: HoldAt; onSet: (fix: string, hold: Hold | null) => void }) {
  const was = at.hold;
  // The course flown to it, as the inbound course, where none is set:
  // the hold straight ahead, a direct entry (AIM 5-3-8).
  const ahead = was ? was.inbound : at.arrivalDeg ?? null;
  // In three figures, north as 360 (units.bearing), as the pilot reads it.
  const [course, setCourse] = useState(ahead === null ? "" : bearing(ahead).replace("°", ""));
  const [way, setWay] = useState<"in" | "out">("in");
  const [right, setRight] = useState(was?.right ?? true);
  const [timed, setTimed] = useState(was ? "min" in was.leg : true);
  const [legMin, setLegMin] = useState(was && "min" in was.leg ? was.leg.min : legMinutes(at.altitudeFt ?? 0));
  const [legNm, setLegNm] = useState(was && "nm" in was.leg ? was.leg.nm : 4);
  const [length, setLength] = useState(was ? lengthCode(was.length) : "2T");
  const deg = course.length === 3 ? Number(course) : NaN;
  const valid = deg >= 0 && deg <= 360;
  const set = () => {
    if (!valid) return;
    const inbound = (way === "in" ? deg : deg + 180) % 360;
    onSet(at.fix, {
      fix: at.fix, inbound, right, leg: timed ? { min: legMin } : { nm: legNm },
      length: lengthOfCode(length) ?? { turns: 2 },
    });
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); set(); }}>
      <ListGroup>
        <ListRow title={<label htmlFor="hold-course">Course</label>}>
          <span className="flex items-center gap-2">
            <Segmented
              label="The course is" value={way} onChange={v => setWay(v as "in" | "out")} testId="hold-way"
              options={[{ value: "in", label: "Inbound" }, { value: "out", label: "Outbound" }]}
            />
            <Input
              id="hold-course" value={course} onChange={e => setCourse(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric" autoComplete="off" placeholder="270" aria-label={`The hold's ${way}bound course, magnetic degrees`}
              className="h-9 w-16 text-right tabular-nums" data-testid="hold-course"
            />
          </span>
        </ListRow>
        <ListRow title="Turns">
          <Segmented
            label="Turns" value={right ? "R" : "L"} onChange={v => setRight(v === "R")} testId="hold-turns"
            options={[{ value: "R", label: "Right" }, { value: "L", label: "Left" }]}
          />
        </ListRow>
        <ListRow title="Legs">
          <span className="flex items-center gap-2">
            <Segmented
              label="Legs by" value={timed ? "time" : "distance"} onChange={v => setTimed(v === "time")} testId="hold-legs"
              options={[{ value: "time", label: "Time" }, { value: "distance", label: "Distance" }]}
            />
            {timed
              ? <PullDown label="Leg time" value={`${legMin}`} options={LEG_MIN.map(m => ({ value: `${m}`, label: `${m} min`, testId: `hold-leg-min-${m}` }))} onChange={v => setLegMin(Number(v))} testId="hold-leg-min" />
              : <PullDown label="Leg distance" value={`${legNm}`} options={LEG_NM.map(n => ({ value: `${n}`, label: `${n} nm`, testId: `hold-leg-nm-${n}` }))} onChange={v => setLegNm(Number(v))} testId="hold-leg-nm" />}
          </span>
        </ListRow>
        <ListRow title="Hold for">
          <PullDown label="Hold for" value={length} options={LENGTHS.map(l => ({ value: l, label: lengthWords(lengthOfCode(l)!), testId: `hold-length-${l}` }))} onChange={setLength} testId="hold-length" />
        </ListRow>
      </ListGroup>
      <Button type="submit" size="lg" disabled={!valid} className={cn("w-full", TEXT.row)} data-testid="hold-set">
        {was ? "Change Hold" : "Add Hold"}
      </Button>
      {was && (
        <Button type="button" size="lg" variant="ghost" onClick={() => onSet(at.fix, null)} className={cn("w-full text-destructive", TEXT.row)} data-testid="hold-remove">
          Remove hold
        </Button>
      )}
    </form>
  );
}
