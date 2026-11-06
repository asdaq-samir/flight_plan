import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Mic, Square } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../../../components/IconButton";
import { PillSection } from "../../../../components/Favorites";
import { PANEL_FIELD } from "../../../../components/panelField";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Spinner } from "../../../../components/ui/spinner";
import { useAtcRadio } from "../../../../lib/atcRadio";
import { TEXT } from "../../../../lib/text";
import SourceChips from "./SourceChips";
import { useAsk, type AskTurn } from "./useAsk";

/** The listening code (lib/atcListening), in a chunk of its own, fetched
 *  as the card comes so the mic's tap starts listening at once: Safari
 *  lets a page listen only straight from the tap (RadioLayer the same). */
let listening: typeof import("../../../../lib/atcListening") | null = null;
const load = () => import("../../../../lib/atcListening").then(m => (listening = m));

/** One question and its answer: the question at the right as a message
 *  of the pilot's own, the answer at the left as prose with its figures
 *  lined up, the tool in use as a passing line while it is, the changes
 *  it proposes as filled chips to tap (useAsk's apply), then the reports
 *  it rests on (SourceChips), and what went wrong in its place. */
export function Turn({ turn }: { turn: AskTurn }) {
  // A chip applies only where there is a plan to change (PlanWorkspace).
  const canApply = useAsk(s => s.applyChange !== null);
  return (
    <div className="flex flex-col gap-1.5" data-testid="ask-turn">
      <p className={cn("max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-primary-foreground", TEXT.prose)} data-testid="ask-question">
        {turn.question}
      </p>
      {turn.status && (
        <p className={cn("flex items-center gap-2 text-muted-foreground", TEXT.note)} role="status" data-testid="ask-status">
          <Spinner aria-hidden />{turn.status}…
        </p>
      )}
      {/* The answer as the assistant's own message: a white card at the
          left with its chips inside, as the canvas's Ask screen (7) has
          it, facing the pilot's blue one. */}
      {(turn.answer || turn.done) && (
        <div className="flex max-w-[92%] flex-col gap-2.5 self-start rounded-2xl rounded-bl-md bg-card px-3.5 py-3 shadow-[0_1px_4px_rgb(0_0_0/0.06)]" data-testid="ask-bubble">
          {turn.answer && <p className={cn("tabular-nums whitespace-pre-wrap", TEXT.prose)} data-testid="ask-answer">{turn.answer}</p>}
          {/* Each change proposed, a filled chip in the tint: the tap
              applies it and the chip says so with a check; nothing is
              applied without the tap. A chip is 32 points, its area the
              44 by the pseudo-element, the row at gap-2. */}
          {turn.actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-testid="ask-actions">
              {turn.actions.map((a, i) => (
                <Button
                  key={i} size="sm" variant={a.applied ? "secondary" : "default"} disabled={a.applied || !canApply}
                  className={cn("relative rounded-full after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", a.applied && "disabled:opacity-100")}
                  onClick={() => useAsk.getState().apply(a.change)} data-testid="ask-action" data-applied={a.applied ? "1" : undefined}
                >
                  {a.applied && <Check aria-hidden />}{a.applied ? a.done : a.label}
                </Button>
              ))}
            </div>
          )}
          {turn.done && <SourceChips sources={turn.sources} testId="ask-source" />}
        </div>
      )}
      {turn.error && <p className={cn("text-destructive-ink", TEXT.note)} role="alert" data-testid="ask-problem">{turn.error}</p>}
    </div>
  );
}

/** What a pilot asks first, offered as chips while nothing has been asked
 *  (the canvas's Ask screen): one tap asks it. */
const FIRST_QUESTIONS = ["Brief me", "Is the weather within my minimums?", "What if I leave an hour later?"];

/**
 * The Brief's first section, the assistant's home: one line, "Ask about
 * this flight", with the microphone and Send at its end, that opens into
 * the conversation as the field is focused or a question is in flight,
 * and stays open while there is one to read (Clear folds it). The
 * answer is asked with the plan, the airplane's position and the pilot's
 * own minimums and currency (useAsk). The microphone is the map's own
 * (lib/atcListening): its pill over the map types what is said, and the
 * words come here and are sent as the pause ends them.
 */
export default function AskSection() {
  const turns = useAsk(s => s.turns);
  const busy = useAsk(s => s.busy);
  const listeningFor = useAsk(s => s.listeningFor);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const expanded = focused || busy || turns.length > 0;
  useEffect(() => { void load(); }, []);
  // The microphone's words, once the pause ends them, asked as typed;
  // the pill put away, its chips being for a command, not a question.
  useEffect(() => {
    if (listeningFor !== "ask") return;
    return useAtcRadio.subscribe(s => {
      const pill = s.pill;
      if (!pill || pill.listening) return;
      useAsk.setState({ listeningFor: null });
      if (!pill.text) return;
      useAtcRadio.setState({ pill: null });
      setText("");
      void useAsk.getState().ask(pill.text);
    });
  }, [listeningFor]);
  const send = () => {
    const question = text.trim();
    if (!question || busy) return;
    setText("");
    void useAsk.getState().ask(question);
  };
  const hear = () => {
    useAsk.setState({ listeningFor: "ask" });
    if (listening) void listening.listenOnce([]);
    else void load().then(m => m.listenOnce([]));
  };
  return (
    <PillSection
      title="Ask" testId="brief-ask"
      right={turns.length > 0 ? <Button variant="ghost" size="sm" onClick={() => useAsk.getState().clear()} data-testid="ask-clear">Clear</Button> : undefined}
    >
      {expanded && turns.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="ask-conversation">
          {turns.map(t => <Turn key={t.id} turn={t} />)}
        </div>
      )}
      {/* The first questions as outlined chips, until one is asked. */}
      {turns.length === 0 && !busy && (
        <div className="flex gap-2 overflow-x-auto pb-1" data-testid="ask-suggestions">
          {FIRST_QUESTIONS.map(q => (
            <Button key={q} variant="outline" size="sm" className="shrink-0 rounded-full border-tint" onClick={() => void useAsk.getState().ask(q)} data-testid="ask-suggestion">
              {q}
            </Button>
          ))}
        </div>
      )}
      {/* The field row as the canvas's Ask screen (7) draws it: a round
          48-point field, the microphone a round white button with the
          tint's glyph beside it, and Send a round filled one; each its
          own 44-point area, so gap-2 is room enough. */}
      <div className="flex items-center gap-2" data-composer="">
        <Input
          ref={field} value={text} onChange={e => setText(e.target.value)} placeholder="Ask about this flight" aria-label="Ask about this flight"
          enterKeyHint="send" autoComplete="off" data-testid="ask-field"
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          className={cn("h-12 rounded-full border-0 px-4", PANEL_FIELD)}
        />
        <IconButton
          label="Ask by voice" variant="outline" size="icon-lg" onClick={hear} disabled={listeningFor === "ask"} data-testid="ask-mic"
          className="size-12 shrink-0 rounded-full border-0 bg-card shadow-[0_1px_4px_rgb(0_0_0/0.12)]"
        >
          <Mic className={cn("size-5", listeningFor === "ask" && "animate-pulse")} strokeWidth={2.4} />
        </IconButton>
        {busy ? (
          <IconButton label="Stop" variant="secondary" size="icon-lg" className="size-12 shrink-0 rounded-full" onClick={() => useAsk.getState().stop()} data-testid="ask-stop">
            <Square className="size-4" />
          </IconButton>
        ) : (
          <IconButton label="Send" variant="default" size="icon-lg" className="size-12 shrink-0 rounded-full" onClick={send} disabled={!text.trim()} data-testid="ask-send">
            <ArrowUp className="size-5" />
          </IconButton>
        )}
      </div>
    </PillSection>
  );
}
