import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import { cn } from "cn";
import FieldHit from "../../components/FieldHit";
import { ListGroup, ListRow } from "../../components/GroupedList";
import QueryState from "../../components/QueryState";
import { trainingQuery } from "../../lib/queryClient";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { ExperienceItem, Training } from "../../lib/api/types";
import { acsCodesIn, lookUp } from "../../lib/checkride";
import { useAcsTable } from "../../lib/useAcsTable";
import { TEXT } from "../../lib/text";
import { FINDING_TONE } from "../../lib/status";
import { inForce, reviewRoute, reviewState, said } from "../../lib/endorsements";
import { GoodTo, SignedRow } from "./Endorsements";

function amount(item: ExperienceItem): string {
  if (item.unit === "h") return `${item.have.toFixed(1)} of ${item.need} h`;
  if (item.unit === "flights") return item.met ? "Done" : "Not yet";
  return `${item.have} of ${item.need}`;
}

/** The knowledge test report's codes, each in the ACS's own words. */
export function KnowledgeCodes({ codes }: { codes: string[] }) {
  const table = useAcsTable();
  return (
    <ListGroup
      title="Knowledge test"
      footer="The codes on the Airman Knowledge Test Report. The examiner must go over each one again at the practical test, and the instructor must endorse that they have been reviewed (61.39(a)(6)(iii))."
    >
      {codes.length === 0 ? (
        <ListRow title={<span className="text-muted-foreground">No codes yet</span>} />
      ) : codes.map(code => {
        const found = table ? lookUp(table, code) : null;
        return (
          <ListRow
            key={code}
            title={<span className="font-mono">{code}</span>}
            description={table ? (found ? `${found.task}${found.element ? `: ${found.element}` : ""}` : `Not in ${table.editions.join(" or ")}`) : "…"}
            data-testid="acs-code"
          />
        );
      })}
    </ListGroup>
  );
}

function KnowledgeTest({ codes, onSave, saving }: { codes: string[]; onSave: (codes: string[]) => void; saving: boolean }) {
  const id = useId();
  const [text, setText] = useState("");
  const typed = acsCodesIn(text);
  return (
    <div className="space-y-3">
      <KnowledgeCodes codes={codes} />
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); onSave([...new Set([...codes, ...typed])]); setText(""); }}>
        <label htmlFor={id} className={cn("text-muted-foreground", TEXT.note)}>Paste or type the report's codes</label>
        <Textarea
          id={id} value={text} onChange={e => setText(e.target.value)} placeholder="PA.I.E.K1 PA.I.D.K2"
          className="font-mono" rows={2} data-testid="acs-codes-input"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-muted-foreground", TEXT.note)}>{typed.length ? `${typed.length} code${typed.length === 1 ? "" : "s"} found` : ""}</span>
          <span className="flex gap-2">
            {codes.length > 0 && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => onSave([])} data-testid="acs-codes-clear">Clear</Button>
            )}
            <Button type="submit" size="sm" disabled={saving || typed.length === 0} data-testid="acs-codes-save">Add</Button>
          </span>
        </div>
      </form>
    </div>
  );
}

/** 61.109(a)'s experience, item by item: the student's page and their
 *  instructor's alike. */
export function ExperienceGroup({ training }: { training: Training }) {
  return (
    <ListGroup
      title="Private pilot experience"
      footer="14 CFR 61.109(a), for an airplane single-engine rating, from the logbook's columns. Dual and cross-country are counted as the smaller of the two on each flight."
    >
      {training.experience.map(item => (
        <ListRow
          key={item.key}
          media={item.met
            ? <Check className={cn("size-5", FINDING_TONE.ok)} aria-label="Met" />
            : <Circle className="size-5 text-muted-foreground" aria-label="Not yet" />}
          title={item.label}
          description={item.rule}
          value={amount(item)}
          data-testid="experience-item"
        />
      ))}
    </ListGroup>
  );
}

/** The student's instructors: their name as their certificate gives it,
 *  which an endorsement names them by, then each instructor asked in by
 *  address -- answered when someone signs in with it and takes it -- and
 *  the solo cross-countries they have put to them. */
function Instructors({ training }: { training: Training }) {
  const queryClient = useQueryClient();
  const keep = (next: Training) => queryClient.setQueryData(["training"], next);
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(training.fullName ?? "");
  const [email, setEmail] = useState("");
  const saveName = useMutation({ mutationFn: (n: string) => api.training.setName(n), onSuccess: keep });
  const ask = useMutation({
    mutationFn: async () => {
      if (name.trim() && name.trim() !== training.fullName) await api.training.setName(name.trim());
      return api.training.askInstructor(email.trim());
    },
    onSuccess: next => { keep(next); setEmail(""); },
  });
  const drop = useMutation({ mutationFn: api.training.dropInstructor, onSuccess: keep });
  const withdraw = useMutation({ mutationFn: api.training.withdrawReview, onSuccess: keep });
  const problem = (saveName.error ?? ask.error ?? drop.error ?? withdraw.error)?.message;
  const named = !!(training.fullName ?? name.trim());
  return (
    <>
      <ListGroup
        title="Your instructor"
        footer="An instructor you ask in sees your experience, endorsements and knowledge test codes here, reviews your solo cross-countries (14 CFR 61.93(c)(3)) and signs your endorsements. They answer by signing in with the address you ask, and either of you can end it."
      >
        <ListRow id={nameId} title="Your name" description="As on your student pilot certificate">
          <FieldHit htmlFor={nameId}><Input
            id={nameId} value={name} placeholder="Avery B. Student" maxLength={120} className="h-8 w-44 sm:w-56" autoComplete="name"
            onChange={e => setName(e.target.value)} data-testid="student-name"
            onBlur={() => { if (name.trim() && name.trim() !== training.fullName) saveName.mutate(name.trim()); }}
          /></FieldHit>
        </ListRow>
        {training.instructors.map(l => (
          <ListRow
            key={l.id} title={l.name ?? l.email}
            description={l.accepted ? [l.certificate, l.email].filter(Boolean).join(" · ") : "Asked, not answered yet"}
            data-testid="instructor-link"
          >
            <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={drop.isPending}
              onClick={() => drop.mutate(l.id)} data-testid="instructor-remove">
              Remove
            </Button>
          </ListRow>
        ))}
        <ListRow id={emailId} title="Ask an instructor">
          <FieldHit htmlFor={emailId}><Input
            id={emailId} type="email" value={email} placeholder="cfi@example.com" className="h-8 w-44 sm:w-56" autoComplete="off"
            onChange={e => setEmail(e.target.value)} data-testid="instructor-email"
          /></FieldHit>
        </ListRow>
        <ListRow
          title={<span className="font-medium text-tint">Ask</span>}
          description={named ? undefined : "Give your name first: your endorsements name you by it"}
          disabled={!named || !/^\S+@\S+\.\S+$/.test(email.trim()) || ask.isPending}
          onClick={() => ask.mutate()} data-testid="instructor-ask"
        />
      </ListGroup>
      {training.reviews.length > 0 && (
        <ListGroup title="Solo cross-countries" footer="Put to your instructor from a saved flight, under Flights.">
          {training.reviews.map(r => (
            <ListRow
              key={r.id} title={<span className="font-mono">{reviewRoute(r)}</span>}
              description={`${said(r.flightOn)} · ${r.makeModel} · ${reviewState(r)}`}
              data-testid="review-row"
            >
              {!r.answeredAt && (
                <Button type="button" variant="ghost" size="sm" disabled={withdraw.isPending} onClick={() => withdraw.mutate(r.id)}>
                  Take back
                </Button>
              )}
            </ListRow>
          ))}
        </ListGroup>
      )}
      {problem && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)} data-testid="instructor-problem">{problem}</p>}
    </>
  );
}

/**
 * The Logbook's Checkride page, for a student on the way to the private
 * pilot practical test: 61.109(a)'s aeronautical experience as the
 * logbook shows it, item by item; the ACS codes on their knowledge test
 * report, each in the FAA's own words; the endorsements, as AC 61-65K has
 * them -- signed in the app by their instructor, with their words, or the
 * day one was signed on paper (and the day a 90-day one runs out); and
 * their instructor. None of it is a sign-off: the instructor's
 * endorsement is.
 */
export default function CheckridePage() {
  const queryClient = useQueryClient();
  // The record the logbook reads too (trainingQuery), and where it could
  // not be fetched, said here with Try again, where the page stayed on
  // "Fetching your record…" for good.
  const asked = useQuery(trainingQuery);
  const training = asked.data;
  const keep = (next: Training) => queryClient.setQueryData(["training"], next);
  const codes = useMutation({ mutationFn: api.training.setKnowledgeTest, onSuccess: keep });
  const endorse = useMutation({
    mutationFn: ({ code, on }: { code: string; on: string | null }) => (on ? api.training.endorse(code, on) : api.training.withdraw(code)),
    onSuccess: keep,
  });
  if (!training) return <QueryState query={asked} fetching="Fetching your record…" failed="Your record could not be fetched." />;
  const recorded = new Map(training.endorsements.map(e => [e.code, e]));
  const signed = inForce(training.signed);
  const voided = training.signed.filter(e => e.voided);
  return (
    <div className="space-y-5">
      <ExperienceGroup training={training} />

      <KnowledgeTest codes={training.knowledgeTestCodes} saving={codes.isPending} onSave={next => codes.mutate(next)} />

      <ListGroup
        title="Endorsements"
        footer="AC 61-65K's student endorsements: signed here by your instructor, or the day one was signed in your paper logbook. Clear a date to take one out."
      >
        {training.kinds.map(kind => {
          const e = signed.get(kind.code);
          if (e) return <SignedRow key={kind.code} kind={kind} e={e} />;
          const on = recorded.get(kind.code);
          return (
            <ListRow
              key={kind.code}
              title={kind.label}
              description={<><span className="block">{kind.rule}</span><GoodTo until={on?.until} /></>}
              data-testid="endorsement"
            >
              <Input
                type="date" aria-label={`${kind.label}, the day endorsed`} className="h-8 w-40"
                value={on?.endorsedOn ?? ""} data-testid={`endorsement-${kind.code}`}
                onChange={e => endorse.mutate({ code: kind.code, on: e.target.value || null })}
              />
            </ListRow>
          );
        })}
      </ListGroup>
      {voided.length > 0 && (
        <ListGroup title="Voided" footer="Signed and later voided by the instructor who signed them, for a correction.">
          {voided.map(e => <SignedRow key={e.id} kind={training.kinds.find(k => k.code === e.code)} e={e} />)}
        </ListGroup>
      )}

      <Instructors training={training} />
    </div>
  );
}
