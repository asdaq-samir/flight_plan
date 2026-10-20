import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import Segmented from "../../../components/Segmented";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import type { Hold } from "../../../lib/holds";
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

const lengthWords = (code: string) => {
  const n = Number(code.slice(0, -1));
  return code.endsWith("T") ? `${n} ${n === 1 ? "turn" : "turns"}` : `${n} min`;
};

/**
 * A hold at a point of the route, set as Garmin's and ForeFlight's
 * pilot-defined holds are, at the owner's ask ("create a left/right
 * hold", mock 4 of the canvas's holds): the course, inbound or outbound;
 * the turns, right (the standard pattern) or left; the legs by time --
 * a minute at or below 14,000 ft, a minute and a half above (AIM 5-3-8)
 * -- or distance; and how long, in turns or minutes. The planner works
 * out the entry from the course flown to it, and adds the hold's time
 * and fuel to the flight's (plan.with_holds). A sheet on a phone with
 * its title on top and Close, as the fix's card is.
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
        sheetOverlayClassName="bg-transparent dark:bg-transparent supports-backdrop-filter:backdrop-blur-none"
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
  const ahead = was ? was.inbound : at.arrivalDeg != null ? Math.round(at.arrivalDeg) % 360 : null;
  const [course, setCourse] = useState(ahead === null ? "" : String(ahead).padStart(3, "0"));
  const [way, setWay] = useState<"in" | "out">("in");
  const [right, setRight] = useState(was?.right ?? true);
  const [timed, setTimed] = useState(was ? "min" in was.leg : true);
  const high = (at.altitudeFt ?? 0) > 14_000;
  const [legMin, setLegMin] = useState(was && "min" in was.leg ? was.leg.min : high ? 1.5 : 1);
  const [legNm, setLegNm] = useState(was && "nm" in was.leg ? was.leg.nm : 4);
  const [length, setLength] = useState(was ? ("turns" in was.length ? `${was.length.turns}T` : `${was.length.minutes}M`) : "2T");
  const deg = course.length === 3 ? Number(course) : NaN;
  const valid = deg >= 0 && deg <= 360;
  const set = () => {
    if (!valid) return;
    const inbound = (way === "in" ? deg : deg + 180) % 360;
    const n = Number(length.slice(0, -1));
    onSet(at.fix, {
      fix: at.fix, inbound, right, leg: timed ? { min: legMin } : { nm: legNm },
      length: length.endsWith("T") ? { turns: n } : { minutes: n },
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
              ? <Choice label="Leg time" value={String(legMin)} options={LEG_MIN.map(m => [String(m), `${m} min`])} onChange={v => setLegMin(Number(v))} testId="hold-leg-min" />
              : <Choice label="Leg distance" value={String(legNm)} options={LEG_NM.map(n => [String(n), `${n} nm`])} onChange={v => setLegNm(Number(v))} testId="hold-leg-nm" />}
          </span>
        </ListRow>
        <ListRow title="Hold for">
          <Choice label="Hold for" value={length} options={LENGTHS.map(l => [l, lengthWords(l)])} onChange={setLength} testId="hold-length" />
        </ListRow>
      </ListGroup>
      <Button type="submit" size="lg" disabled={!valid} className={cn("w-full", TEXT.row)} data-testid="hold-set">
        {was ? "Change hold" : "Add hold"}
      </Button>
      {was && (
        <Button type="button" size="lg" variant="ghost" onClick={() => onSet(at.fix, null)} className={cn("w-full text-destructive", TEXT.row)} data-testid="hold-remove">
          Remove hold
        </Button>
      )}
    </form>
  );
}

/** A discrete choice as a pull-down chip, as the procedures' are: the
 *  stock DropdownMenu's radio items, not a slider. */
function Choice({ label, value, options, onChange, testId }: {
  label: string; value: string; options: [string, string][]; onChange: (value: string) => void; testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button" aria-label={`${label}: ${options.find(o => o[0] === value)?.[1] ?? value}`} data-testid={testId}
          className={cn("relative flex h-8 items-center gap-0.5 rounded-full bg-foreground/8 px-2.5 font-semibold text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
        >
          {options.find(o => o[0] === value)?.[1] ?? value}
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map(([v, words]) => <DropdownMenuRadioItem key={v} value={v} data-testid={`${testId}-${v}`}>{words}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
