import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import StatusBadge from "../../../../components/StatusBadge";
import { Button } from "../../../../components/ui/button";
import { Textarea } from "../../../../components/ui/textarea";
import { api } from "../../../../lib/api/client";
import type { OralCitation, OralGrade, OralQuestion } from "../../../../lib/api/types";
import { nextFocus } from "../../../../lib/oral";
import { pilotQuery } from "../../../../lib/queryClient";
import { TEXT } from "../../../../lib/text";
import { useAcsTable } from "../../../../lib/useAcsTable";

const VERDICT: Record<OralGrade["verdict"], { words: string; tone: "up" | "checking" | "down" }> = {
  satisfactory: { words: "Satisfactory", tone: "up" },
  partial: { words: "Partly there", tone: "checking" },
  unsatisfactory: { words: "Unsatisfactory", tone: "down" },
};

function Citations({ citations, title }: { citations: OralCitation[]; title: string }) {
  if (citations.length === 0) return null;
  return (
    <ListGroup title={title}>
      {citations.map((c, i) => (
        <ListRow
          key={i} href={c.url}
          title={c.title}
          description={<><span className="block text-foreground">“{c.quote}”</span><span className="block">{c.source}</span></>}
          data-testid="oral-citation"
        />
      ))}
    </ListGroup>
  );
}

/**
 * The briefing's Mock Oral (the planner's app.oral): an examiner's
 * question about this flight on an ACS element -- the student's
 * knowledge-test codes first -- an answer typed, and that answer graded
 * against 14 CFR and the AIM, each source quoted word for word. A
 * preview, the developer's: its answers are to be reviewed by a CFI
 * before a student sees them, and the page says it is a study aid.
 */
export default function MockOral({ plan }: { plan: string }) {
  const answerId = useId();
  const table = useAcsTable();
  const { data: pilot } = useQuery(pilotQuery);
  const { data: training } = useQuery({ queryKey: ["training"], queryFn: api.training.get, enabled: !!pilot });
  const [asked, setAsked] = useState<{ codes: string[]; questions: string[] }>({ codes: [], questions: [] });
  const [answer, setAnswer] = useState("");
  const question = useMutation({
    mutationFn: () => {
      const focus = nextFocus(table!, training?.knowledgeTestCodes ?? [], asked.codes);
      return api.oral.question({ plan, focus, asked: asked.questions });
    },
    onSuccess: q => {
      setAsked(a => ({ codes: [...a.codes, q.acs_code], questions: [...a.questions, q.question].slice(-20) }));
      setAnswer("");
      grade.reset();
    },
  });
  const grade = useMutation({
    mutationFn: (q: OralQuestion) => api.oral.grade({
      question: q.question, model_answer: q.model_answer, key_points: q.key_points, source_ids: q.source_ids, answer,
    }),
  });
  const q = question.data;
  const g = grade.data;
  const problem = question.error ?? grade.error;

  return (
    <div className="space-y-4" data-testid="mock-oral">
      <p className={cn("text-muted-foreground", TEXT.prose)}>
        An examiner’s questions about this flight, from the ACS{training?.knowledgeTestCodes.length ? ", your knowledge test’s codes first" : ""},
        and your answers checked against 14 CFR and the AIM, quoted word for word. A study aid in preview: its answers
        have not yet been reviewed by an instructor.
      </p>

      {q && (
        <div className="space-y-3">
          <ListGroup title={`Question ${asked.questions.length}`}>
            <ListRow
              title={<span className={cn("block font-medium", TEXT.prose)} data-testid="oral-question">{q.question}</span>}
              description={q.acs_code}
            />
          </ListGroup>
          {q.unsupported && (
            <p className={cn("flex gap-1.5 text-amber-700 dark:text-amber-400", TEXT.note)}>
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              None of its answer’s quotes could be found in the sources: take it with care.
            </p>
          )}
          {!g && (
            <form className="space-y-2" onSubmit={e => { e.preventDefault(); grade.mutate(q); }}>
              <label htmlFor={answerId} className={cn("text-muted-foreground", TEXT.note)}>Your answer, as you would give it</label>
              <Textarea id={answerId} rows={4} value={answer} onChange={e => setAnswer(e.target.value)} data-testid="oral-answer" />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={question.isPending || grade.isPending} onClick={() => question.mutate()}>
                  Another question
                </Button>
                <Button type="submit" size="sm" disabled={!answer.trim() || grade.isPending} data-testid="oral-check">
                  {grade.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  {grade.isPending ? "Checking…" : "Check my answer"}
                </Button>
              </div>
            </form>
          )}
          {g && (
            <div className="space-y-3" data-testid="oral-grade">
              <div className="flex items-center gap-2">
                <StatusBadge tone={VERDICT[g.verdict].tone}>{VERDICT[g.verdict].words}</StatusBadge>
              </div>
              <p className={TEXT.prose}>{g.feedback}</p>
              {g.missed.length > 0 && (
                <ListGroup title="What it missed">
                  {g.missed.map(m => <ListRow key={m} title={m} />)}
                </ListGroup>
              )}
              <ListGroup title="An answer">
                <ListRow title={<span className={cn("block font-normal", TEXT.prose)}>{q.model_answer}</span>} />
              </ListGroup>
              <Citations title="From the sources" citations={[...g.citations, ...q.citations.filter(c => !g.citations.some(d => d.quote === c.quote))]} />
            </div>
          )}
        </div>
      )}

      {(!q || g) && (
        <Button
          type="button" className="w-full" disabled={!table || question.isPending} onClick={() => question.mutate()}
          data-testid="oral-ask"
        >
          {question.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {question.isPending ? "The examiner is thinking…" : q ? "Next question" : "Ask me a question"}
        </Button>
      )}

      {problem && <p className={cn("text-red-700 dark:text-red-400", TEXT.prose)} role="alert">{problem.message}</p>}

      {q && (
        <p className={cn("px-1 text-muted-foreground", TEXT.note)}>
          14 CFR as of {q.editions.cfr_issued ? format(parseISO(q.editions.cfr_issued), "d MMM yyyy") : "lately"}; the AIM
          as read {q.editions.aim_fetched ? format(parseISO(q.editions.aim_fetched), "d MMM yyyy") : "lately"}.
        </p>
      )}
    </div>
  );
}
