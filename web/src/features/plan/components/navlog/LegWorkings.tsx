import { useId, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import {
  ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger,
} from "../../../../components/ResponsivePopover";
import Segmented from "../../../../components/Segmented";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import type { Leg } from "../../../../lib/api/types";
import { ANSWERS, checks, heading, workingsOf, type AnswerKey, type Workings } from "../../../../lib/workings";
import { TEXT } from "../../../../lib/text";

/** A figure as the student would write it: a heading round the compass,
 *  the correction signed, the rest to its unit's precision. */
function written(key: AnswerKey, value: number): string {
  if (key === "th" || key === "mh") return heading(value);
  if (key === "wca") return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(0)}°`;
  if (key === "fuel") return `${value.toFixed(1)} gal`;
  return `${Math.round(value)} ${key === "gs" ? "kt" : "min"}`;
}

function Worked({ workings }: { workings: Workings }) {
  return (
    <ListGroup
      footer={workings.climb
        ? `The log's time and fuel add the climb's ${Math.round(workings.climb.min)} min and ${workings.climb.gal.toFixed(1)} gal, flown at climb speed and burn.`
        : "Headings to the nearest degree, as an E6B gives them."}
    >
      {workings.steps.map(step => (
        <ListRow key={step.name} title={step.name} description={step.sum} value={step.result} data-testid="working-step" />
      ))}
    </ListGroup>
  );
}

/** The student's own figures, checked against the planner's within an
 *  E6B's accuracy (ANSWERS): each marked right, or wrong with the answer. */
function TryIt({ workings }: { workings: Workings }) {
  const id = useId();
  const [typed, setTyped] = useState<Partial<Record<AnswerKey, string>>>({});
  const [checked, setChecked] = useState(false);
  return (
    <form
      className="space-y-3" onSubmit={e => { e.preventDefault(); setChecked(true); }}
      aria-label="Work the leg out yourself"
    >
      <ListGroup footer="The wind correction signed: + right, − left. Time and fuel for the cruise, without the climb.">
        {ANSWERS.map(answer => {
          const value = typed[answer.key];
          const number = value === undefined || value.trim() === "" ? null : Number(value);
          // Only the figures typed are marked: a student works them one
          // at a time, and the rest are not given away.
          const marked = checked && number !== null && Number.isFinite(number);
          const right = marked && checks(answer.key, number, workings.answers[answer.key]);
          return (
            <ListRow
              key={answer.key} id={`${id}-${answer.key}`}
              title={answer.label}
              description={marked && !right ? `Not quite: ${written(answer.key, workings.answers[answer.key])}` : undefined}
              data-testid={`try-${answer.key}`}
            >
              <span className="flex items-center gap-1.5">
                {marked && (right
                  ? <Check className="size-4 text-green-700 dark:text-green-400" aria-label="Right" />
                  : <X className="size-4 text-red-700 dark:text-red-400" aria-label="Not right" />)}
                <Input
                  id={`${id}-${answer.key}`} inputMode="decimal" className="h-8 w-20 text-right tabular-nums"
                  value={value ?? ""} data-testid={`try-${answer.key}-input`}
                  onChange={e => { setTyped({ ...typed, [answer.key]: e.target.value }); setChecked(false); }}
                />
                <span className={cn("w-7 text-muted-foreground", TEXT.detail)}>{answer.unit}</span>
              </span>
            </ListRow>
          );
        })}
      </ListGroup>
      <div className="flex justify-end">
        <Button type="submit" size="sm" data-testid="try-check">Check</Button>
      </div>
    </form>
  );
}

/**
 * The selected leg worked out, as a student shows it on the examiner's
 * nav log (ACS PA.I.D): the wind triangle from the true course to the
 * compass heading, the ground speed, the time and the fuel, each with
 * its sum -- or, under Try it, the student's own figures checked against
 * them. A popover from `md` up, a sheet on a phone.
 */
export default function LegWorkings({ leg }: { leg: Leg }) {
  const workings = workingsOf(leg);
  const [mode, setMode] = useState("worked");
  if (!workings) return null;
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button" variant="link" size="sm" className={cn("h-auto p-0 text-tint", TEXT.detail)}
          onClick={e => e.stopPropagation()} data-testid="leg-workings"
        >
          Show the work
        </Button>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title={`${leg.from} to ${leg.to}, worked out`} className="w-[26rem] max-w-[calc(100vw-2rem)] p-3"
        align="start" data-testid="leg-workings-content"
      >
        <div className="space-y-3">
          <Segmented
            label="Worked out or yours" value={mode} onChange={setMode}
            options={[{ value: "worked", label: "Worked out" }, { value: "try", label: "Try it" }]}
            testId="workings-mode"
          />
          {mode === "worked" ? <Worked workings={workings} /> : <TryIt workings={workings} />}
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
