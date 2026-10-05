import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, Circle } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { ExperienceItem, Training } from "../../lib/api/types";
import { acsCodesIn, ENDORSEMENTS, endorsementUntil, lookUp } from "../../lib/checkride";
import { useAcsTable } from "../../lib/useAcsTable";
import { TEXT } from "../../lib/text";

const day = (iso: string) => format(parseISO(iso), "d MMM yyyy");

function amount(item: ExperienceItem): string {
  if (item.unit === "h") return `${item.have.toFixed(1)} of ${item.need} h`;
  if (item.unit === "flights") return item.met ? "Done" : "Not yet";
  return `${item.have} of ${item.need}`;
}

function KnowledgeTest({ codes, onSave, saving }: { codes: string[]; onSave: (codes: string[]) => void; saving: boolean }) {
  const id = useId();
  const table = useAcsTable();
  const [text, setText] = useState("");
  const typed = acsCodesIn(text);
  return (
    <div className="space-y-3">
      <ListGroup
        title="Knowledge test"
        footer="The codes on your Airman Knowledge Test Report. Your examiner must go over each one again at the practical test, and your instructor must endorse that you have reviewed them (61.39(a)(6)(iii))."
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

/**
 * The Logbook's Checkride page, for a student on the way to the private
 * pilot practical test: 61.109(a)'s aeronautical experience as the
 * logbook shows it, item by item; the ACS codes on their knowledge test
 * report, each in the FAA's own words; and the endorsements their
 * instructor has given, with the day (and the day a 90-day one runs out).
 * None of it is a sign-off: the instructor's endorsement is.
 */
export default function CheckridePage({ training }: { training: Training | undefined }) {
  const queryClient = useQueryClient();
  const keep = (next: Training) => queryClient.setQueryData(["training"], next);
  const codes = useMutation({ mutationFn: api.training.setKnowledgeTest, onSuccess: keep });
  const endorse = useMutation({
    mutationFn: ({ code, on }: { code: string; on: string | null }) => (on ? api.training.endorse(code, on) : api.training.withdraw(code)),
    onSuccess: keep,
  });
  if (!training) return <p className={cn("text-muted-foreground", TEXT.prose)}>Fetching your record…</p>;
  const given = new Map(training.endorsements.map(e => [e.code, e.endorsedOn]));
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="space-y-5">
      <ListGroup
        title="Private pilot experience"
        footer="14 CFR 61.109(a), for an airplane single-engine rating, from your logbook's columns. Dual and cross-country are counted as the smaller of the two on each flight."
      >
        {training.experience.map(item => (
          <ListRow
            key={item.key}
            media={item.met
              ? <Check className="size-5 text-green-700 dark:text-green-400" aria-label="Met" />
              : <Circle className="size-5 text-muted-foreground" aria-label="Not yet" />}
            title={item.label}
            description={item.rule}
            value={amount(item)}
            data-testid="experience-item"
          />
        ))}
      </ListGroup>

      <KnowledgeTest codes={training.knowledgeTestCodes} saving={codes.isPending} onSave={next => codes.mutate(next)} />

      <ListGroup title="Endorsements" footer="AC 61-65's student endorsements, as your instructor gives them: the day each was signed. Clear a date to take one out.">
        {ENDORSEMENTS.map(kind => {
          const on = given.get(kind.code) ?? null;
          const until = on ? endorsementUntil(kind, on) : null;
          return (
            <ListRow
              key={kind.code}
              title={kind.label}
              description={(
                <>
                  <span className="block">{kind.rule}</span>
                  {until && (
                    <span className={cn("block", until < today && "text-red-700 dark:text-red-400")}>
                      {until < today ? `Ran out ${day(until)}` : `Good to ${day(until)}`}
                    </span>
                  )}
                </>
              )}
              data-testid="endorsement"
            >
              <Input
                type="date" aria-label={`${kind.label}, the day endorsed`} className="h-8 w-40"
                value={on ?? ""} data-testid={`endorsement-${kind.code}`}
                onChange={e => endorse.mutate({ code: kind.code, on: e.target.value || null })}
              />
            </ListRow>
          );
        })}
      </ListGroup>
    </div>
  );
}
