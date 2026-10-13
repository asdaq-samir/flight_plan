import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import TickBox from "../../components/TickBox";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import type { EndorsementKind, Instructor, SignedEndorsement } from "../../lib/api/types";
import { renderEndorsement } from "../../lib/checkride";
import { said, signatureLine } from "../../lib/endorsements";
import { localDay } from "../../lib/clock";
import { FINDING_TONE } from "../../lib/status";
import { TEXT } from "../../lib/text";

/** "Good to 11 Jan 2027", or in red once it has run out. */
export function GoodTo({ until }: { until: string | null | undefined }) {
  if (!until) return null;
  const out = until < localDay();
  return <span className={cn("block", out && FINDING_TONE.stop)}>{out ? `Ran out ${said(until)}` : `Good to ${said(until)}`}</span>;
}

/** A signed endorsement's words and signature line, as signed. */
export function SignedWords({ text, signature }: { text: string; signature: string }) {
  return (
    <div className={cn("space-y-2 px-3 py-2.5", TEXT.prose)} data-testid="signed-words">
      <p>{text}</p>
      <p className="font-mono text-muted-foreground">{signature}</p>
    </div>
  );
}

/** A row for an endorsement signed in the app: its name, rule and
 *  signature line, the day it runs out, and its words a tap away -- with,
 *  for the instructor who signed it, a way to void it for a correction. */
export function SignedRow({ kind, e, who, onVoid, voiding }: {
  kind: EndorsementKind | undefined;
  e: SignedEndorsement;
  /** Whom it was signed for, on the instructor's own record. */
  who?: string;
  onVoid?: () => void;
  voiding?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow
        title={kind?.label ?? e.code}
        description={(
          <>
            <span className="block">
              {[who, kind?.rule, e.voided ? "Voided" : `Signed ${said(e.signedOn)}`].filter(Boolean).join(" · ")}
            </span>
            {!e.voided && <GoodTo until={e.until} />}
          </>
        )}
        value={open ? "Hide" : "Read"}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        data-testid="signed-endorsement"
      />
      {open && <SignedWords text={e.text} signature={e.signature} />}
      {open && onVoid && !e.voided && (
        <ListRow title={<span className="text-destructive">Void it</span>} disabled={voiding} onClick={onVoid} data-testid="signed-void" />
      )}
    </>
  );
}

/** 14 CFR 61.93(d)(1)-(3): what an instructor must determine of a solo
 *  cross-country themselves, before endorsing it; (4) and (5), the
 *  student's endorsements, the record answers. */
const DETERMINATIONS = [
  { rule: "61.93(d)(1)", label: "The student's cross-country planning is correct for the flight" },
  { rule: "61.93(d)(2)", label: "The current and forecast weather allow it to be completed under VFR" },
  { rule: "61.93(d)(3)", label: "The student is proficient to conduct it safely" },
];

/**
 * An endorsement signed for a student, as AC 120-78B has an electronic
 * signature made: its blanks filled in, the words read as they will be
 * signed, and then a deliberate tap on the signature -- for a solo
 * cross-country, only once the instructor has ticked what 61.93(d) asks
 * them to determine. The webapp signs what these fields make and nothing
 * else (InstructorService.sign).
 */
export function SignForm({ kind, studentId, studentName, instructor, initial, reviewId, onDone, onCancel }: {
  kind: EndorsementKind;
  studentId: number;
  studentName: string;
  instructor: Instructor;
  initial?: Record<string, string>;
  reviewId?: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Record<string, string>>(
    () => Object.fromEntries(kind.fields.map(f => [f.key, initial?.[f.key] ?? ""])),
  );
  const crossCountry = kind.code === "solo-xc-flight";
  const [determined, setDetermined] = useState(DETERMINATIONS.map(() => false));
  const signedOn = localDay();
  const text = renderEndorsement(kind.template, studentName, fields);
  const missing = kind.fields.filter(f => f.required && !fields[f.key]?.trim());
  const lapsed = !!instructor.until && instructor.until < signedOn;
  const sign = useMutation({
    mutationFn: () => api.instructor.sign(studentId, { code: kind.code, fields, text, signedOn, reviewId: reviewId ?? null }),
    onSuccess: record => {
      queryClient.setQueryData(["student-training", studentId], record);
      void queryClient.invalidateQueries({ queryKey: ["instructor"] });
      onDone();
    },
  });
  const ready = missing.length === 0 && !lapsed && (!crossCountry || determined.every(Boolean));
  return (
    <div className="space-y-4" data-testid="sign-form">
      <ListGroup title={kind.label} footer={`AC 61-65K ${kind.paragraph}, 14 CFR ${kind.rule}.`}>
        {kind.fields.map(f => (
          <ListRow key={f.key} id={`sign-${kind.code}-${f.key}`} title={f.label}>
            <Input
              id={`sign-${kind.code}-${f.key}`} value={fields[f.key] ?? ""} placeholder={f.example} maxLength={300}
              className="h-8 w-44 sm:w-56" data-testid={`sign-field-${f.key}`}
              onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </ListRow>
        ))}
      </ListGroup>
      {crossCountry && (
        <ListGroup title="Your determination" footer="14 CFR 61.93(d): yours to determine before a solo cross-country. The student's endorsements, (4) and (5), are above.">
          {DETERMINATIONS.map((d, i) => (
            <ListRow
              key={d.rule} role="checkbox" aria-checked={determined[i]} media={<TickBox on={determined[i]!} />}
              title={d.label} description={d.rule} data-testid="sign-determination"
              onClick={() => setDetermined(prev => prev.map((on, j) => (j === i ? !on : on)))}
            />
          ))}
        </ListGroup>
      )}
      <ListGroup
        title="Instructor's signature"
        footer="What you sign: the words, and under them your signature with the date, your certificate number and its date, as AC 61-65K asks. Once signed it is not changed; a correction voids it for a new one."
      >
        <SignedWords text={text} signature={signatureLine(instructor, signedOn)} />
        <ListRow
          title={<span className="font-medium text-tint">Sign as {instructor.fullName}</span>}
          description={lapsed ? <span className={FINDING_TONE.stop}>Your {instructor.untilKind === "EXP" ? "certificate expired" : "recent experience ran out"} on {said(instructor.until!)} (14 CFR 61.197(a))</span>
            : missing.length ? `Fill in ${missing.map(f => f.label.toLowerCase()).join(", ")}` : undefined}
          disabled={!ready || sign.isPending} onClick={() => sign.mutate()} data-testid="sign-endorsement"
        />
        <ListRow title="Cancel" onClick={onCancel} />
      </ListGroup>
      {sign.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)} data-testid="sign-problem">{sign.error.message}</p>}
    </div>
  );
}
