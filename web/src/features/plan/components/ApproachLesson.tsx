import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { ListChoices, ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import Segmented from "../../../components/Segmented";
import StatusBadge from "../../../components/StatusBadge";
import { Button } from "../../../components/ui/button";
import { Spinner } from "../../../components/ui/spinner";
import { useIsMobile } from "../../../hooks/use-mobile";
import {
  approachBrief, approachQuiz, coachingSteps, lessonPath, lessonProfile, pathBetween, type CoachStep, type LessonInput,
} from "../../../lib/approachLesson";
import type { AircraftProfile, ProcedureDrawing, QuizAnswer } from "../../../lib/api/types";
import { noteAt } from "../../../lib/assignedLessons";
import { bearingDeg } from "../../../lib/geo";
import { NO_FOCUS, endLessonMap, useLessonMap } from "../../../lib/map/lessonMap";
import type { PickedProcedure } from "../../../lib/procedures";
import { airportQuery, procedureQuery } from "../../../lib/queryClient";
import { FINDING_TONE } from "../../../lib/status";
import { GROUP_HEADING, TEXT, TEXT_POINTS } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/** The lesson's one safety line, its subtitle: the plate, not this, is
 *  what is flown (CLAUDE.md's safety principle, kept off the pilot's
 *  screens as a footnote at the owner's word, 2026-10-16). */
const AID = "Training aid — fly the FAA plate";

type Page = "brief" | "fly" | "quiz";
const PAGES = [{ value: "brief", label: "Brief" }, { value: "fly", label: "Fly" }, { value: "quiz", label: "Quiz" }];
/** Ground speeds to fly the final at, kt: a discrete setting, a segmented
 *  control (the app's iOS rules), its descent rate and time worked from
 *  the one picked. 90 to start, a light airplane's approach speed or near
 *  it in still air -- the pilot's to change, said on the control. */
const SPEEDS = [70, 90, 120] as const;

/** An approach an instructor set as a lesson (AssignedLesson): their name
 *  and their notes at its fixes, shown on the brief's and the flying's
 *  cards, and where the lesson reports how far the student has come -- the
 *  brief finished, flown to its end, each quiz answer (the answers so far,
 *  of how many) -- with what went wrong sending it, said on the card. */
export interface FromInstructor {
  instructorName: string;
  notes: Record<string, string>;
  onBriefed: () => void;
  onFlown: () => void;
  onQuiz: (answers: QuizAnswer[], of: number) => void;
  problem: string | null;
}

/** "Your instructor: …" under a step whose fix they left a note at. */
function InstructorNote({ from, fix }: { from: FromInstructor | undefined; fix: string | null }) {
  const note = noteAt(from?.notes, fix);
  if (!from || !note) return null;
  return <ListRow title={<span className={TEXT.prose}>Your instructor: “{note}”</span>} description={from.instructorName} data-testid="approach-instructor-note" />;
}

/** A speed of the airplane's own figures, where its profile carries one
 *  (its POH's VREF, or its VSO): none of the app's profiles do yet, and
 *  then no category is said. */
function speedOf(aircraft: AircraftProfile | null | undefined, key: "vref_kt" | "vso_kt"): number | null {
  const value = (aircraft as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * An approach taught, at the owner's ask ("do it all", 2026-10-30), from
 * a picked approach's Learn This Approach (ProcedureMenu): Brief, Fly and
 * Quiz, a segmented control at the card's head. The brief walks the
 * approach as an instructor has it briefed, a Got It a step; Fly takes the
 * airplane fix by fix along it on the map with a coaching word at each and
 * the approach from the side; the quiz asks it back from its own data. Each
 * step rings its fix or draws over its part on the chart (LessonLayer). A
 * card in the map's panel on a phone, as the hold's is; its subtitle the
 * one line that says it is a training aid.
 */
export default function ApproachLesson({ at, aircraft, onClose, from }: {
  at: PickedProcedure | null;
  aircraft: AircraftProfile | null;
  onClose: () => void;
  /** Set by an instructor (AssignedLesson); none from a picked approach's menu. */
  from?: FromInstructor;
}) {
  const isMobile = useIsMobile();
  const { data: drawing, error, isPending } = useQuery({ ...procedureQuery(at ?? { ident: "", id: "", transition: null }), enabled: !!at });
  const { data: field } = useQuery({ ...airportQuery(at?.ident ?? ""), enabled: !!at });
  // The lesson off the chart as it is put away, whichever way.
  useEffect(() => (at ? endLessonMap : undefined), [at]);
  const input = useMemo<LessonInput | null>(() => (drawing ? {
    drawing, frequencies: field?.frequencies ?? null, vrefKt: speedOf(aircraft, "vref_kt"), vsoKt: speedOf(aircraft, "vso_kt"),
  } : null), [drawing, field, aircraft]);
  return (
    <ResponsivePopover open={!!at} onOpenChange={next => { if (!next) onClose(); }}>
      <ResponsivePopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none fixed top-16 left-1/2 size-0" /></ResponsivePopoverAnchor>
      <ResponsivePopoverContent
        title={drawing?.name ?? "Approach Lesson"} description={AID} side="bottom" align="center"
        className="flex max-h-[34rem] w-80 flex-col gap-3 overflow-y-auto p-3" data-testid="approach-lesson"
        action={<CloseButton onClick={onClose} data-testid="approach-lesson-close" />}
      >
        {/* The popover shows no subtitle: the line at its top there. */}
        {!isMobile && <p className={cn("text-muted-foreground", TEXT.note)} data-testid="approach-lesson-aid">{AID}</p>}
        {error ? (
          <p className={cn(FINDING_TONE.stop, TEXT.prose)} role="alert">The approach could not be had: {error.message}</p>
        ) : isPending || !input ? (
          <p role="status" className={cn("flex items-center gap-2 text-muted-foreground", TEXT.prose)}><Spinner aria-hidden />Fetching the approach…</p>
        ) : (
          <Lesson key={`${input.drawing.airport}:${input.drawing.id}:${input.drawing.transition ?? ""}`} input={input} from={from} />
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

function Lesson({ input, from }: { input: LessonInput; from?: FromInstructor }) {
  const [page, setPage] = useState<Page>("brief");
  const [gs, setGs] = useState<number>(90);
  // The approach on the chart while the lesson is open; each page says
  // what of it its step shows (its effects run before this one).
  useEffect(() => { useLessonMap.setState({ drawing: input.drawing }); }, [input.drawing]);
  return (
    <>
      <Segmented
        label="Lesson step" value={page} onChange={v => setPage(v as Page)} options={PAGES} className="w-full [&>*]:flex-1"
        testId="approach-lesson-steps"
      />
      {from?.problem && <p role="alert" className={cn(FINDING_TONE.stop, TEXT.note)} data-testid="approach-lesson-problem">{from.problem}</p>}
      {page === "brief" && <BriefPage input={input} from={from} onDone={() => { from?.onBriefed(); setPage("fly"); }} />}
      {page === "fly" && <FlyPage input={input} from={from} gs={gs} onGs={setGs} onDone={() => setPage("quiz")} />}
      {page === "quiz" && <QuizPage input={input} from={from} gs={gs} />}
    </>
  );
}

/** "3 of 10" over a step, as a group's heading. */
const Progress = ({ at, of }: { at: number; of: number }) => (
  <p className={GROUP_HEADING} aria-live="polite" data-testid="approach-lesson-progress">{at + 1} of {of}</p>
);

function BriefPage({ input, from, onDone }: { input: LessonInput; from?: FromInstructor; onDone: () => void }) {
  const items = useMemo(() => approachBrief(input), [input]);
  const [at, setAt] = useState(0);
  const item = items[Math.min(at, items.length - 1)]!;
  useEffect(() => { useLessonMap.setState({ focus: item.focus, flight: null }); }, [item]);
  const last = at >= items.length - 1;
  return (
    <div className="space-y-3" data-testid="approach-brief">
      <Progress at={at} of={items.length} />
      <ListGroup title={item.title}>
        {item.lines.map(line => <ListRow key={line} title={line} />)}
        <InstructorNote from={from} fix={item.focus.fix} />
      </ListGroup>
      <Button className="w-full" onClick={() => (last ? onDone() : setAt(at + 1))} data-testid="approach-brief-next">
        {last ? "Fly It" : "Got It"}
      </Button>
    </div>
  );
}

function FlyPage({ input, from, gs, onGs, onDone }: {
  input: LessonInput;
  from?: FromInstructor;
  gs: number;
  onGs: (gs: number) => void;
  onDone: () => void;
}) {
  const steps = useMemo(() => coachingSteps(input, gs), [input, gs]);
  // Where each step is and what it shows, the same at any speed: a new
  // speed changes the words, and the airplane stays where it is.
  const places = useMemo(() => coachingSteps(input, SPEEDS[1]).map(s => ({ at: s.at, focus: s.focus })), [input]);
  const path = useMemo(() => lessonPath(input.drawing), [input.drawing]);
  const [at, setAt] = useState(0);
  const step = steps[Math.min(at, steps.length - 1)];
  // The airplane flown from the last step's place to this one's, along the
  // approach's line; at the first, put at it.
  useEffect(() => {
    const place = places[at];
    if (!place) return;
    const from = at > 0 ? places[at - 1]?.at ?? null : null;
    const to = place.at;
    const way = to ? (from ? pathBetween(path, from, to) : [to]) : [];
    const a = way.at(-2), b = way.at(-1);
    useLessonMap.setState(s => ({
      focus: place.focus,
      flight: way.length ? { path: way, track: a && b ? bearingDeg(a, b) : s.flight?.track ?? null, id: (s.flight?.id ?? 0) + 1 } : s.flight,
    }));
  }, [at, path, places]);
  // Flown to its last step: the instructor told, once a lesson.
  const flownToEnd = steps.length > 0 && at >= steps.length - 1;
  const onFlown = from?.onFlown;
  useEffect(() => { if (flownToEnd) onFlown?.(); }, [flownToEnd, onFlown]);
  if (!step) return <p className={cn("text-muted-foreground", TEXT.prose)}>See the plate</p>;
  const last = at >= steps.length - 1;
  return (
    <div className="space-y-3" data-testid="approach-fly">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-muted-foreground", TEXT.note)}>Ground speed</span>
        <Segmented
          label="Ground speed" value={String(gs)} onChange={v => onGs(Number(v))}
          options={SPEEDS.map(s => ({ value: String(s), label: `${s} kt` }))} testId="approach-fly-speed"
        />
      </div>
      <Progress at={at} of={steps.length} />
      <ListGroup title={step.title}>
        <ListRow
          title={<span className={cn("block font-medium", TEXT.prose)} data-testid="approach-coach">{step.say}</span>}
          description={step.why ?? undefined}
        />
        <InstructorNote from={from} fix={step.focus.fix} />
      </ListGroup>
      <LessonProfile drawing={input.drawing} steps={steps} at={at} />
      <div className="flex gap-2">
        {last ? (
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setAt(0)} data-testid="approach-fly-again">Fly It Again</Button>
            <Button className="flex-1" onClick={onDone} data-testid="approach-fly-quiz">Quiz Me</Button>
          </>
        ) : (
          <Button className="w-full" onClick={() => setAt(at + 1)} data-testid="approach-fly-next">Next Fix</Button>
        )}
      </div>
    </div>
  );
}

/**
 * The approach from the side, as the plate's profile view draws it, a
 * sketch from the coded data: each fix's crossing altitude, the path down
 * from the FAF at its coded angle dashed in the tint, and the airplane at
 * the step's fix. No minimums: they are the plate's.
 */
function LessonProfile({ drawing, steps, at }: { drawing: ProcedureDrawing; steps: CoachStep[]; at: number }) {
  const { marks, path } = useMemo(() => lessonProfile(drawing), [drawing]);
  const known = marks.filter(m => m.ft != null);
  if (known.length < 1 || marks.length < 2) return null;
  const W = 288, H = 96, PAD = 14;
  const nms = marks.map(m => m.alongNm);
  const lo = Math.min(...nms), hi = Math.max(...nms);
  const fts = [...known.map(m => m.ft!), ...(path ? [path.to.ft] : [])];
  const top = Math.max(...fts), bottom = Math.min(...fts, top - 1000);
  const x = (nm: number) => PAD + ((nm - lo) / Math.max(1e-6, hi - lo)) * (W - 2 * PAD);
  const y = (ft: number) => PAD + ((top - ft) / Math.max(1, top - bottom)) * (H - 2 * PAD - TEXT_POINTS.caption);
  // The fix the step is at, and the altitude it is crossed at; past the
  // last fix (the decision, the missed approach), at the end of the path.
  const step = steps[at];
  const here = marks.find(m => m.ident === step?.focus.fix && m.ft != null)
    ?? (step?.key === "decision" && path ? { alongNm: path.to.nm, ft: path.to.ft } : null);
  const line = known.map(m => `${x(m.alongNm)},${y(m.ft!)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} className="h-24 w-full rounded-xl bg-muted/60" role="img" data-testid="approach-profile"
      aria-label={`The approach from the side: ${known.map(m => `${m.ident} ${altFt(m.ft)} ft`).join(", ")}${path ? `, then down at ${drawing.glidepath_deg?.toFixed(2)}°` : ""}`}
    >
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-procedure" />
      {path && (
        <line x1={x(path.from.nm)} y1={y(path.from.ft)} x2={x(path.to.nm)} y2={y(path.to.ft)} stroke="var(--tint)" strokeWidth={2} strokeDasharray="5 4" />
      )}
      {marks.map(m => (
        <g key={m.ident}>
          {m.ft != null && <circle cx={x(m.alongNm)} cy={y(m.ft)} r={2.5} className="fill-procedure" />}
          <text x={x(m.alongNm)} y={H - 4} textAnchor="middle" fontSize={TEXT_POINTS.caption} className="fill-muted-foreground">
            {/^RW\d/.test(m.ident) ? "RWY" : m.ident}
          </text>
        </g>
      ))}
      {here && <circle cx={x(here.alongNm)} cy={y(here.ft!)} r={5} fill="var(--tint)" stroke="#fff" strokeWidth={2} data-testid="approach-profile-airplane" />}
    </svg>
  );
}

function QuizPage({ input, from, gs }: { input: LessonInput; from?: FromInstructor; gs: number }) {
  const questions = useMemo(() => approachQuiz(input, gs), [input, gs]);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  // This attempt's answers, for the instructor's score: Ask Again starts anew.
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const done = at >= questions.length;
  const q = done ? null : questions[at]!;
  // A wrong answer shows where the right one is; until then, nothing.
  useEffect(() => {
    useLessonMap.setState({ focus: q && picked !== null && picked !== q.answer ? q.focus : NO_FOCUS, flight: null });
  }, [q, picked]);
  if (questions.length === 0) return <p className={cn("text-muted-foreground", TEXT.prose)}>See the plate</p>;
  if (!q) {
    return (
      <div className="space-y-3" data-testid="approach-quiz-done">
        <p className={cn("font-semibold", TEXT.row)} role="status">{right} of {questions.length} right</p>
        <Button className="w-full" onClick={() => { setAt(0); setPicked(null); setRight(0); setAnswers([]); }} data-testid="approach-quiz-again">Ask Again</Button>
      </div>
    );
  }
  const answered = picked !== null;
  const pick = (choice: number) => {
    if (answered) return;
    setPicked(choice);
    if (choice === q.answer) setRight(right + 1);
    const next = [...answers, { question: q.prompt, chosen: q.choices[choice]!, right: choice === q.answer }];
    setAnswers(next);
    from?.onQuiz(next, questions.length);
  };
  return (
    <div className="space-y-3" data-testid="approach-quiz">
      <Progress at={at} of={questions.length} />
      <p className={cn("font-medium", TEXT.prose)} data-testid="approach-quiz-question">{q.prompt}</p>
      {/* A tap or Space answers, as the procedures' menus pick (ProcedureMenu):
          the arrow keys move between the choices without answering. */}
      <ListChoices value={picked === null ? "" : String(picked)} onChange={() => undefined} label={q.prompt}>
        <ListGroup>
          {q.choices.map((choice, i) => (
            <ListRow key={choice} radio={String(i)} title={choice} disabled={answered && i !== picked} onClick={() => pick(i)} data-testid="approach-quiz-choice" />
          ))}
        </ListGroup>
      </ListChoices>
      {answered && (
        <div className="space-y-2" data-testid="approach-quiz-result">
          <StatusBadge tone={picked === q.answer ? "up" : "down"}>{picked === q.answer ? "Right" : "Not quite"}</StatusBadge>
          {picked !== q.answer && <p className={cn("font-medium", TEXT.prose)}>The answer: {q.choices[q.answer]}</p>}
          <p className={cn("text-muted-foreground", TEXT.prose)}>{q.explain}</p>
          <Button className="w-full" onClick={() => { setAt(at + 1); setPicked(null); }} data-testid="approach-quiz-next">
            {at === questions.length - 1 ? "See My Score" : "Next Question"}
          </Button>
        </div>
      )}
    </div>
  );
}
