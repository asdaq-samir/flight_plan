import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
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
 *  lined up, the tool in use as a passing line while it is, then the
 *  reports it rests on (SourceChips), and what went wrong in its place. */
function Turn({ turn }: { turn: AskTurn }) {
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
      {turn.answer && (
        <p className={cn("tabular-nums whitespace-pre-wrap", TEXT.prose)} data-testid="ask-answer">{turn.answer}</p>
      )}
      {turn.error && <p className={cn("text-destructive-ink", TEXT.note)} role="alert" data-testid="ask-problem">{turn.error}</p>}
      {turn.done && <SourceChips sources={turn.sources} testId="ask-source" />}
    </div>
  );
}

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
  const wanted = useAsk(s => s.wanted);
  const listeningFor = useAsk(s => s.listeningFor);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const expanded = focused || busy || turns.length > 0;
  useEffect(() => { void load(); }, []);
  // Asked for from the route's ••• menu: the field focused, the keyboard up.
  useEffect(() => {
    if (!wanted) return;
    field.current?.focus();
    field.current?.scrollIntoView({ block: "nearest" });
    // Heard once: the Brief opened later by its own button is not asked.
    useAsk.setState({ wanted: 0 });
  }, [wanted]);
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
      {/* The field and its two 32-point buttons at gap-3, so the buttons'
          44-point areas (index.css's ::after) meet without overlapping
          (the iOS review's rule 1). */}
      <div className="flex items-center gap-3">
        <Input
          ref={field} value={text} onChange={e => setText(e.target.value)} placeholder="Ask about this flight" aria-label="Ask about this flight"
          enterKeyHint="send" autoComplete="off" data-testid="ask-field"
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          className={cn("rounded-full border-0", PANEL_FIELD)}
        />
        <IconButton label="Ask by voice" size="icon-sm" onClick={hear} disabled={listeningFor === "ask"} data-testid="ask-mic">
          <Mic className="size-5" />
        </IconButton>
        {busy ? (
          <IconButton label="Stop" variant="secondary" size="icon-sm" className="rounded-full" onClick={() => useAsk.getState().stop()} data-testid="ask-stop">
            <Square className="size-4" />
          </IconButton>
        ) : (
          <IconButton label="Send" variant="default" size="icon-sm" className="rounded-full" onClick={send} disabled={!text.trim()} data-testid="ask-send">
            <ArrowUp className="size-5" />
          </IconButton>
        )}
      </div>
    </PillSection>
  );
}
