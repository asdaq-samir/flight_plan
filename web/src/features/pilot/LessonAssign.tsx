import { Suspense, lazy, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { cn } from "cn";
import FieldHit from "../../components/FieldHit";
import { ListChoices, ListGroup, ListRow } from "../../components/GroupedList";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import type { ApproachLesson, FlightSummary, Training } from "../../lib/api/types";
import { dueWords, lessonPicked, lessonStatus, notableFixes, notesToSend } from "../../lib/assignedLessons";
import { localDay } from "../../lib/clock";
import { said } from "../../lib/endorsements";
import { procedureQuery } from "../../lib/queryClient";
import { FINDING_TONE } from "../../lib/status";
import { TEXT } from "../../lib/text";

// Its own chunk, as on a flight's page: drawn only where a track came.
const ApproachDebriefs = lazy(() => import("../../components/ApproachDebrief"));

/** A cycle's procedures hold for its 28 days, under the key the map's and
 *  the debrief's lists share. */
const listQuery = (ident: string) => ({
  queryKey: ["procedures", ident], queryFn: () => api.procedures(ident), staleTime: 6 * 60 * 60_000,
});

const route = (f: Pick<FlightSummary, "departureIdent" | "stops" | "destinationIdent">) =>
  [f.departureIdent, ...f.stops, f.destinationIdent].join(" ");

/**
 * The approaches an instructor set one student to learn (LessonService),
 * on the student's page under Logbook, Instructing: each with how far the
 * student has come -- briefed, flown, the quiz's score -- and a page of its
 * own; and Assign an Approach, a field's approach picked from the
 * planner's procedures with a note at any of its fixes and a day to have
 * it done by.
 */
export default function StudentLessons({ studentId, training }: { studentId: number; training: Training }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<number | "new" | null>(null);
  const keep = (next: Training) => queryClient.setQueryData(["student-training", studentId], next);
  const today = localDay();
  const lesson = typeof open === "number" ? training.lessons.find(l => l.id === open) ?? null : null;
  if (open === "new") return <AssignForm studentId={studentId} onDone={next => { keep(next); setOpen(null); }} onCancel={() => setOpen(null)} />;
  if (lesson) return <LessonDetail lesson={lesson} studentId={studentId} onDone={next => { if (next) keep(next); setOpen(null); }} />;
  return (
    <ListGroup title="Approach lessons">
      {training.lessons.map(l => (
        <ListRow
          key={l.id} title={`${l.procedureName} · ${l.airportIdent}`}
          description={[dueWords(l, today), lessonStatus(l)].filter(Boolean).join(" · ")}
          onClick={() => setOpen(l.id)} chevron data-testid="student-lesson"
        />
      ))}
      <ListRow title={<span className="font-medium text-tint">Assign an Approach</span>} onClick={() => setOpen("new")} data-testid="lesson-assign" />
    </ListGroup>
  );
}

/** A field, one of its approaches, a note at any of its fixes and a day. */
function AssignForm({ studentId, onDone, onCancel }: { studentId: number; onDone: (next: Training) => void; onCancel: () => void }) {
  const ids = { field: useId(), due: useId() };
  const [field, setField] = useState("");
  const [picked, setPicked] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [due, setDue] = useState("");
  const ident = field.trim().toUpperCase();
  const typed = /^[A-Z0-9]{3,4}$/.test(ident);
  const list = useQuery({ ...listQuery(ident), enabled: typed });
  const approaches = (list.data?.procedures ?? []).filter(p => p.kind === "approach");
  const procedure = approaches.find(p => p.id === picked) ?? null;
  const at = list.data && procedure ? { ident: list.data.airport, id: procedure.id, transition: null } : null;
  const drawing = useQuery({ ...procedureQuery(at ?? { ident: "", id: "", transition: null }), enabled: !!at });
  const fixes = drawing.data ? notableFixes(drawing.data) : [];
  const assign = useMutation({
    mutationFn: () => api.instructor.assignLesson(studentId, {
      airportIdent: list.data!.airport, procedureId: procedure!.id, procedureName: procedure!.name, cycle: list.data!.cycle,
      // Only the notes at this approach's fixes: one typed at another's goes.
      fixNotes: notesToSend(Object.fromEntries(Object.entries(notes).filter(([fix]) => fixes.includes(fix)))),
      dueOn: due || null,
    }),
    onSuccess: onDone,
  });
  return (
    <div className="space-y-4" data-testid="lesson-form">
      <ListGroup title="Assign an approach">
        <ListRow id={ids.field} title="Airport">
          <FieldHit htmlFor={ids.field}><Input
            id={ids.field} value={field} placeholder="KDLH" maxLength={4} autoCapitalize="characters" autoComplete="off"
            className="h-8 w-28 font-mono uppercase" data-testid="lesson-field"
            onChange={e => { setField(e.target.value); setPicked(""); setNotes({}); }}
          /></FieldHit>
        </ListRow>
        <ListRow id={ids.due} title="Due" description="Optional">
          <FieldHit htmlFor={ids.due}><Input id={ids.due} type="date" value={due} onChange={e => setDue(e.target.value)} className="h-8 w-40" data-testid="lesson-due" /></FieldHit>
        </ListRow>
      </ListGroup>
      {typed && (list.isPending ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching its approaches…</p>
      ) : list.error ? (
        <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Its approaches could not be had ({list.error.message}).</p>
      ) : approaches.length === 0 ? (
        <p className={cn("px-1 text-muted-foreground", TEXT.prose)}>No instrument approaches at {ident}</p>
      ) : (
        <ListChoices value={picked} onChange={id => { setPicked(id); setNotes({}); }} label="Approach">
          <ListGroup title="Approach">
            {approaches.map(p => (
              <ListRow key={p.id} radio={p.id} title={p.name} onClick={() => { setPicked(p.id); setNotes({}); }} data-testid="lesson-approach" />
            ))}
          </ListGroup>
        </ListChoices>
      ))}
      {at && (drawing.isPending ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching its fixes…</p>
      ) : drawing.error ? (
        <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Its fixes could not be had ({drawing.error.message}).</p>
      ) : (
        // A note at a fix, shown to the student on the lesson's brief and
        // as it is flown there ("Your instructor: …").
        <ListGroup title="Your notes at its fixes">
          {fixes.map(fix => <NoteRow key={fix} fix={fix} value={notes[fix] ?? ""} onChange={v => setNotes(n => ({ ...n, [fix]: v }))} />)}
        </ListGroup>
      ))}
      <ListGroup>
        <ListRow
          title={<span className="font-medium text-tint">Assign</span>} disabled={!at || assign.isPending}
          onClick={() => assign.mutate()} data-testid="lesson-assign-send"
        />
        <ListRow title="Cancel" onClick={onCancel} />
      </ListGroup>
      {assign.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>{assign.error.message}</p>}
    </div>
  );
}

function NoteRow({ fix, value, onChange }: { fix: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <ListRow id={id} title={<span className="font-mono">{/^RW\d/.test(fix) ? `Runway ${fix.slice(2)}` : fix}</span>}>
      <FieldHit htmlFor={id}><Input
        id={id} value={value} maxLength={300} placeholder="A note" className="h-8 w-44 sm:w-56" autoComplete="off"
        aria-label={`Your note at ${fix}`} onChange={e => onChange(e.target.value)} data-testid={`lesson-note-${fix}`}
      /></FieldHit>
    </ListRow>
  );
}

/** One lesson: the notes left, the student's progress and quiz answers,
 *  the debrief of the newest flight put to the instructor that landed at
 *  the field, and Take Back. */
function LessonDetail({ lesson, studentId, onDone }: { lesson: ApproachLesson; studentId: number; onDone: (next?: Training) => void }) {
  const remove = useMutation({ mutationFn: () => api.instructor.removeLesson(studentId, lesson.id), onSuccess: next => onDone(next) });
  const notes = Object.entries(lesson.fixNotes);
  return (
    <div className="space-y-4" data-testid="lesson-detail">
      <ListGroup title={`${lesson.procedureName} · ${lesson.airportIdent}`}>
        <ListRow title="Progress" value={lessonStatus(lesson)} data-testid="lesson-status" />
        {lesson.briefedAt && <ListRow title="Briefed" value={said(lesson.briefedAt.slice(0, 10))} />}
        {lesson.flownAt && <ListRow title="Flown in the lesson" value={said(lesson.flownAt.slice(0, 10))} />}
        {lesson.dueOn && <ListRow title="Due" value={said(lesson.dueOn)} />}
        {notes.map(([fix, note]) => <ListRow key={fix} title={<span className="font-mono">{fix}</span>} description={note} />)}
      </ListGroup>
      {lesson.quizAnswers.length > 0 && (
        <ListGroup title="Quiz">
          {lesson.quizAnswers.map((a, i) => (
            <ListRow
              key={i} title={a.question} description={a.chosen} data-testid="lesson-answer"
              media={a.right ? <Check className={cn("size-5", FINDING_TONE.ok)} aria-label="Right" /> : <X className={cn("size-5", FINDING_TONE.stop)} aria-label="Not right" />}
            />
          ))}
        </ListGroup>
      )}
      <LessonDebrief lesson={lesson} studentId={studentId} />
      <ListGroup>
        <ListRow title={<span className="text-destructive">Take Back This Lesson</span>} disabled={remove.isPending} onClick={() => remove.mutate()} data-testid="lesson-remove" />
        <ListRow title="Done" onClick={() => onDone()} data-testid="lesson-done" />
      </ListGroup>
      {remove.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>{remove.error.message}</p>}
    </div>
  );
}

/** The student's flights put to the instructor that landed at the field
 *  with a track, newest first: the one picked -- the newest to start --
 *  debriefed against the lesson's approach (lib/approachDebrief). */
function LessonDebrief({ lesson, studentId }: { lesson: ApproachLesson; studentId: number }) {
  const [picked, setPicked] = useState<number | null>(null);
  const flight = lesson.flights.find(f => f.id === picked) ?? lesson.flights[0] ?? null;
  const track = useQuery({
    queryKey: ["reviewed-track", studentId, flight?.id], queryFn: () => api.instructor.reviewedTrack(studentId, flight!.id), enabled: !!flight,
  });
  if (!flight) return null;
  return (
    <div className="space-y-3" data-testid="lesson-debrief">
      <ListChoices value={String(flight.id)} onChange={id => setPicked(Number(id))} label="Flight to debrief">
        <ListGroup title="Flown, put to you">
          {lesson.flights.map(f => (
            <ListRow
              key={f.id} radio={String(f.id)} title={<span className="font-mono">{route(f)}</span>}
              description={said((f.plannedFor ?? f.createdAt).slice(0, 10))} onClick={() => setPicked(f.id)} data-testid="lesson-flight"
            />
          ))}
        </ListGroup>
      </ListChoices>
      {track.error ? (
        <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Its track could not be fetched ({track.error.message}).</p>
      ) : track.data ? (
        <Suspense fallback={null}>
          <ApproachDebriefs
            fields={[lesson.airportIdent]} points={track.data.points} picked={[lessonPicked(lesson)]} only={lesson.procedureId}
            none={`The ${lesson.procedureName} is not in this flight's track`}
          />
        </Suspense>
      ) : (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching its track…</p>
      )}
    </div>
  );
}
