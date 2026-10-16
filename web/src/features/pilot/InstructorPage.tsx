import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { cn } from "cn";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import ConsoleClose from "../../components/ConsoleClose";
import FieldHit from "../../components/FieldHit";
import { ListGroup, ListRow } from "../../components/GroupedList";
import Segmented from "../../components/Segmented";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { CrossCountryReview, EndorsementKind, Instructor, InstructorRequest, StudentRow } from "../../lib/api/types";
import { planHrefOf } from "../../lib/flightLink";
import { LEVEL_TONE, riskLine, type RiskLevel } from "../../lib/frat";
import { FINDING_TONE } from "../../lib/status";
import { TEXT } from "../../lib/text";
import { feet, gal, nm } from "../../lib/units";
import { ExperienceGroup, KnowledgeCodes } from "./CheckridePage";
import { acDay, inForce, reviewRoute, said } from "../../lib/endorsements";
import { GoodTo, SignedRow, SignForm } from "./Endorsements";

/** Minutes as a nav log writes them: "1:35". */
const hm = (min: number) => `${Math.floor(Math.round(min) / 60)}:${String(Math.round(min) % 60).padStart(2, "0")}`;

/** The certificate as endorsements print it, given or changed. */
function CertificateForm({ instructor, onDone }: { instructor: Instructor; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const ids = { name: useId(), number: useId(), until: useId() };
  const [draft, setDraft] = useState<InstructorRequest>({
    fullName: instructor.fullName ?? "", certificate: instructor.certificate ?? "",
    until: instructor.until ?? "", untilKind: instructor.untilKind ?? "RE",
  });
  const save = useMutation({
    mutationFn: () => api.instructor.set({ ...draft, fullName: draft.fullName.trim(), certificate: draft.certificate.trim() }),
    onSuccess: next => { queryClient.setQueryData(["instructor"], next); onDone?.(); },
  });
  const ready = draft.fullName.trim() && /^[A-Za-z0-9]{4,20}$/.test(draft.certificate.trim()) && draft.until;
  return (
    <>
      <ListGroup
        title="Your flight instructor certificate"
        footer="As every endorsement you sign carries it (AC 61-65K): your name, the certificate number with its ratings' letters, and the end of your recent experience (14 CFR 61.197) or, on an older certificate, its expiration date."
      >
        <ListRow id={ids.name} title="Name">
          <FieldHit htmlFor={ids.name}><Input id={ids.name} value={draft.fullName} placeholder="J. J. Jones" maxLength={120} className="h-8 w-44 sm:w-56"
            onChange={e => setDraft({ ...draft, fullName: e.target.value })} data-testid="cfi-name" /></FieldHit>
        </ListRow>
        <ListRow id={ids.number} title="Certificate">
          <FieldHit htmlFor={ids.number}><Input id={ids.number} value={draft.certificate} placeholder="987654321CFI" maxLength={20} className="h-8 w-44 font-mono sm:w-56"
            autoCapitalize="characters" onChange={e => setDraft({ ...draft, certificate: e.target.value })} data-testid="cfi-number" /></FieldHit>
        </ListRow>
        <ListRow title="Its date">
          <Segmented
            label="What the date is" value={draft.untilKind} onChange={v => setDraft({ ...draft, untilKind: v as InstructorRequest["untilKind"] })}
            options={[{ value: "RE", label: "Recent experience" }, { value: "EXP", label: "Expires" }]} testId="cfi-until-kind"
          />
        </ListRow>
        <ListRow id={ids.until} title={draft.untilKind === "RE" ? "Recent experience ends" : "Expires"}>
          <FieldHit htmlFor={ids.until}><Input id={ids.until} type="date" value={draft.until} className="h-8 w-40"
            onChange={e => setDraft({ ...draft, until: e.target.value })} data-testid="cfi-until" /></FieldHit>
        </ListRow>
        <ListRow
          title={<span className="font-medium text-tint">Save</span>} disabled={!ready || save.isPending}
          onClick={() => save.mutate()} data-testid="cfi-save"
        />
        {onDone && <ListRow title="Cancel" onClick={onDone} />}
      </ListGroup>
      {save.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>{save.error.message}</p>}
    </>
  );
}

/** What the student's record answers of 61.93(d), and the flight as saved. */
function ReviewSection({ review, kind, studentId, studentName, instructor }: {
  review: CrossCountryReview;
  kind: EndorsementKind;
  studentId: number;
  studentName: string;
  instructor: Instructor;
}) {
  const queryClient = useQueryClient();
  const [answering, setAnswering] = useState<"sign" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const decline = useMutation({
    mutationFn: () => api.instructor.decline(review.id, note.trim()),
    onSuccess: next => {
      queryClient.setQueryData(["instructor"], next);
      void queryClient.invalidateQueries({ queryKey: ["student-training", studentId] });
      setAnswering(null);
    },
  });
  const f = review.flight;
  const landings = [...f.stops, f.destinationIdent];
  return (
    <div className="space-y-4" data-testid="review">
      <ListGroup
        title={`${reviewRoute(review)}, ${said(review.flightOn)}`}
        footer={review.note ? `“${review.note}”` : undefined}
      >
        <ListRow title="Airplane" value={[review.makeModel, f.aircraftTailNumber].filter(Boolean).join(" · ")} />
        <ListRow title="Altitude" value={feet(f.cruiseAltitudeFt)} />
        {f.totalDistanceNm != null && <ListRow title="Distance" value={nm(f.totalDistanceNm)} />}
        {f.totalEteMin != null && <ListRow title="Time" value={hm(f.totalEteMin)} />}
        {f.totalFuelGal != null && <ListRow title="Fuel" value={gal(f.totalFuelGal)} />}
        {f.risk && (
          <ListRow
            title="Risk" description={f.risk.factors.join(" · ") || undefined}
            value={<span className={LEVEL_TONE[f.risk.level as RiskLevel]}>{riskLine(f.risk)}</span>}
          />
        )}
        <ConsoleClose>
          <ListRow title="Open on the map" description="Its nav log, and today's weather and NOTAMs along it" to={planHrefOf(f)} data-testid="review-open" />
        </ConsoleClose>
      </ListGroup>
      <ListGroup title="The student's endorsements" footer="14 CFR 61.93(d)(4) and (5), as their record has them.">
        {review.checks.map(c => (
          <ListRow
            key={c.rule} title={c.label} description={`${c.rule} · ${c.detail}`} data-testid="review-check"
            media={c.met ? <Check className={cn("size-5", FINDING_TONE.ok)} aria-label="Met" /> : <X className={cn("size-5", FINDING_TONE.stop)} aria-label="Not met" />}
          />
        ))}
      </ListGroup>
      {answering === "sign" ? (
        <SignForm
          kind={kind} studentId={studentId} studentName={studentName} instructor={instructor} reviewId={review.id}
          initial={{
            from: f.departureIdent, to: f.destinationIdent, via: f.stops.length ? f.stops.join(", ") : "direct",
            landings: landings.join(", "), mm: review.makeModel, date: acDay(review.flightOn),
          }}
          onDone={() => setAnswering(null)} onCancel={() => setAnswering(null)}
        />
      ) : answering === "decline" ? (
        <ListGroup title="Not endorsed" footer="Your note goes to the student by email and on their Checkride page.">
          <div className="p-2">
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
              placeholder="Why, and what to change" aria-label="Why not" data-testid="review-decline-note" />
          </div>
          <ListRow title={<span className="font-medium text-tint">Send</span>} disabled={!note.trim() || decline.isPending}
            onClick={() => decline.mutate()} data-testid="review-decline-send" />
          <ListRow title="Cancel" onClick={() => setAnswering(null)} />
        </ListGroup>
      ) : (
        <ListGroup>
          <ListRow title={<span className="font-medium text-tint">Endorse this flight</span>} onClick={() => setAnswering("sign")} data-testid="review-endorse" />
          <ListRow title={<span className="font-medium text-destructive">Not endorsed</span>} onClick={() => setAnswering("decline")} data-testid="review-decline" />
        </ListGroup>
      )}
      {decline.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>{decline.error.message}</p>}
    </div>
  );
}

/**
 * One student, as their instructor reads them: the solo cross-countries
 * waiting on them, 61.109's experience from the student's logbook, their
 * knowledge test codes, and each AC 61-65K endorsement -- signed here,
 * recorded from paper, or not yet, with a tap to sign one.
 */
function StudentPage({ row, instructor }: { row: StudentRow; instructor: Instructor }) {
  const { data: training, error } = useQuery({
    queryKey: ["student-training", row.studentId], queryFn: () => api.instructor.student(row.studentId),
  });
  const [signing, setSigning] = useState<EndorsementKind | null>(null);
  if (error) return <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Their record could not be fetched ({error.message}).</p>;
  if (!training) return <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching their record…</p>;
  const signed = inForce(training.signed);
  const recorded = new Map(training.endorsements.map(e => [e.code, e]));
  const crossCountry = training.kinds.find(k => k.code === "solo-xc-flight")!;
  const waiting = training.reviews.filter(r => !r.answeredAt);
  const name = training.fullName ?? row.name;
  return (
    <div className="space-y-5" data-testid="student-page">
      {waiting.map(r => (
        <ReviewSection key={r.id} review={r} kind={crossCountry} studentId={row.studentId} studentName={name} instructor={instructor} />
      ))}
      {signing ? (
        <SignForm
          kind={signing} studentId={row.studentId} studentName={name} instructor={instructor}
          onDone={() => setSigning(null)} onCancel={() => setSigning(null)}
        />
      ) : (
        <ListGroup
          title="Endorsements"
          footer={training.fullName ? "Tap one to sign it, in AC 61-65K's words." : "They have not given their name as on their certificate yet: an endorsement names them by it."}
        >
          {training.kinds.map(kind => {
            const e = signed.get(kind.code);
            if (e) return <SignedRow key={kind.code} kind={kind} e={e} />;
            const paper = recorded.get(kind.code);
            return (
              <ListRow
                key={kind.code} title={kind.label}
                description={<><span className="block">{kind.rule}{paper ? ` · on paper ${said(paper.endorsedOn)}` : ""}</span><GoodTo until={paper?.until} /></>}
                value="Sign" disabled={!training.fullName} onClick={() => setSigning(kind)} data-testid={`sign-${kind.code}`}
              />
            );
          })}
        </ListGroup>
      )}
      <ExperienceGroup training={training} />
      <KnowledgeCodes codes={training.knowledgeTestCodes} />
    </div>
  );
}

/**
 * The Logbook's Instructing page, for a flight instructor: their
 * certificate as endorsements carry it, the students asking them in --
 * taken by signing in with the address asked -- their students, each a
 * page of their own with the solo cross-countries waiting on them, and
 * what they have signed in the last 3 years: the record 14 CFR 61.189(b)
 * and (c) ask an instructor to keep, each one voidable for a correction.
 */
export default function InstructorPage() {
  const queryClient = useQueryClient();
  const { data: instructor, error } = useQuery({ queryKey: ["instructor"], queryFn: api.instructor.get });
  const [editing, setEditing] = useState(false);
  const keep = (next: Instructor) => queryClient.setQueryData(["instructor"], next);
  const accept = useMutation({ mutationFn: api.instructor.accept, onSuccess: keep });
  const leave = useMutation({ mutationFn: api.instructor.leave, onSuccess: keep });
  const voidOne = useMutation({ mutationFn: api.instructor.voidEndorsement, onSuccess: keep });
  const stop = useMutation({ mutationFn: api.instructor.stop, onSuccess: keep });
  if (error) return <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Could not fetch it ({error.message}).</p>;
  if (!instructor) return <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching…</p>;
  const problem = (accept.error ?? leave.error ?? voidOne.error ?? stop.error)?.message;
  const pages = Object.fromEntries(instructor.students.map(s => [`student-${s.studentId}`, {
    title: s.name, content: <StudentPage row={s} instructor={instructor} />,
  }]));
  const kindOf = (code: string) => instructor.kinds.find(k => k.code === code);
  return (
    <ConsolePages back="Instructing" pages={pages}>
      <div className="space-y-5" data-testid="instructor-page">
        {!instructor.certificate || editing ? (
          <CertificateForm instructor={instructor} onDone={instructor.certificate ? () => setEditing(false) : undefined} />
        ) : (
          <ListGroup title="Your certificate">
            <ListRow title={instructor.fullName ?? ""} description={<span className="font-mono">{instructor.certificate}</span>}
              value={<GoodTo until={instructor.until} />} data-testid="cfi-certificate" />
            <ListRow title={<span className="font-medium text-tint">Change</span>} onClick={() => setEditing(true)} />
          </ListGroup>
        )}

        {instructor.asking.length > 0 && (
          <ListGroup title="Asking you" footer="Students who asked you to be their instructor, at this address.">
            {instructor.asking.map(s => (
              <ListRow key={s.linkId} title={s.name} description={s.email} data-testid="student-ask">
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={leave.isPending} onClick={() => leave.mutate(s.linkId)}>Decline</Button>
                  <Button type="button" size="sm" disabled={accept.isPending} onClick={() => accept.mutate(s.linkId)} data-testid="student-accept">Accept</Button>
                </span>
              </ListRow>
            ))}
          </ListGroup>
        )}

        <ListGroup
          title="Students"
          footer={instructor.students.length ? "Each with their experience, endorsements and the solo cross-countries waiting on you." : "A student asks you in from their Checkride page, with your address."}
        >
          {instructor.students.length === 0 ? (
            <ListRow title={<span className="text-muted-foreground">None yet</span>} />
          ) : instructor.students.map(s => (
            <PageRow
              key={s.linkId} page={`student-${s.studentId}`} title={s.name}
              description={[
                `${s.experienceMet} of ${s.experienceOf} of 61.109`,
                s.soloUntil ? `solo to ${said(s.soloUntil)}` : null,
                s.reviewsWaiting ? `${s.reviewsWaiting} waiting on you` : null,
              ].filter(Boolean).join(" · ")}
            />
          ))}
        </ListGroup>

        {instructor.signed.length > 0 && (
          <ListGroup
            title="Signed"
            footer="What you have signed here in the last 3 years, the record 14 CFR 61.189 asks you to keep: kept when a student's account goes. Void one to correct it, and sign it again."
          >
            {instructor.signed.map(e => (
              <SignedRow
                key={e.id} kind={kindOf(e.code)} e={e} who={e.studentName}
                onVoid={() => voidOne.mutate(e.id)} voiding={voidOne.isPending}
              />
            ))}
          </ListGroup>
        )}

        {instructor.certificate && !editing && (
          <ListGroup footer="What you have signed stays signed, and your students stay yours until either of you ends it.">
            <ListRow title={<span className="text-destructive">Stop instructing here</span>} disabled={stop.isPending} onClick={() => stop.mutate()} />
          </ListGroup>
        )}
        {problem && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>{problem}</p>}
      </div>
    </ConsolePages>
  );
}
