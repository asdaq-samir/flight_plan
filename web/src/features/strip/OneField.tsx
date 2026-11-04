import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../components/CloseButton";
import IconButton from "../../components/IconButton";
import { PANEL_FIELD_FILL } from "../../components/panelField";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAsk } from "../plan/components/ask/useAsk";
import { useAtcRadio } from "../../lib/atcRadio";
import { GROUP_HEADING, TEXT } from "../../lib/text";
import { readField, type FieldCommand } from "./fieldCommands";

/** The listening code (lib/atcListening), a chunk of its own, fetched as
 *  the field comes so the mic's tap starts listening at once: Safari lets
 *  a page listen only straight from the tap (AskCard, RadioLayer the same). */
let listening: typeof import("../../lib/atcListening") | null = null;
const load = () => import("../../lib/atcListening").then(m => (listening = m));
/** The answer's rendering, the Brief's own (AskCard's Turn), fetched with
 *  the first answer: the field itself is on the first load, the Brief's
 *  card is not. */
const Turn = lazy(() => import("../plan/components/ask/AskCard").then(m => ({ default: m.Turn })));

/** A chip under the field: outlined in the tint, its words the tint's,
 *  32 tall with its 44-point area round it (gap-2 keeps the areas apart). */
const CHIP = cn("relative h-8 shrink-0 rounded-full border-tint px-3.5 text-tint after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']", TEXT.detail);

/**
 * The one field at the foot of the chart, in every state of the sheet
 * (MapPanel's `foot`): "Where to, or ask anything", 56 points round, the
 * microphone a round blue button beside it. What it takes is read by
 * readField -- idents are a route, a name a place, a screen's word that
 * screen, anything else a question for the assistant -- and done by the
 * planner (`onLine`), which answers why not where it cannot, said under
 * the field (lib/problems' rule: where it happens, never a toast).
 * Suggestions as chips while it is focused and empty, each one tap. The
 * assistant's last answer is a card over the field (AskCard's Turn),
 * its ✕ forgetting the conversation.
 *
 * The microphone listens once, as the Brief's Ask does (lib/atcListening
 * listenOnce): the map's pill types what is said, and the words come
 * here as the pause ends them, handled as typed. In the air the field is
 * the radio's: the pill's words in it as they come, its chips the
 * commands (RadioLayer), nothing typed.
 */
export default function OneField({ suggestions, flying = false, onLine, onFocus }: {
  suggestions: string[];
  flying?: boolean;
  /** The line read (readField) and as typed: null once done, else why not. */
  onLine: (command: FieldCommand, text: string) => Promise<string | null>;
  /** The field focused: the sheet up from the pill, clear of the keyboard. */
  onFocus?: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const last = useAsk(s => s.turns.at(-1) ?? null);
  const asking = useAsk(s => s.busy);
  const pillText = useAtcRadio(s => s.pill?.text ?? "");
  const pillListening = useAtcRadio(s => !!s.pill?.listening);
  useEffect(() => { void load(); }, []);
  const submit = async (line: string) => {
    const command = readField(line);
    if (!command || busy) return;
    setProblem(null);
    setBusy(true);
    setText("");
    const why = await onLine(command, line);
    setBusy(false);
    if (why) setProblem(why);
  };
  // The microphone's words once the pause ends them, handled as typed and
  // the pill put away, its chips being for the air (CallActions); in the
  // air the pill stays, its chips the way.
  useEffect(() => {
    if (!hearing || flying) return;
    return useAtcRadio.subscribe(s => {
      const pill = s.pill;
      if (!pill || pill.listening) return;
      setHearing(false);
      if (!pill.text) {
        if (pill.error) setProblem(pill.error);
        useAtcRadio.setState({ pill: null });
        return;
      }
      useAtcRadio.setState({ pill: null });
      void submit(pill.text);
    });
    // submit reads the latest props through the closure it was made in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hearing, flying]);
  const hear = () => {
    setProblem(null);
    setHearing(true);
    if (listening) void listening.listenOnce([]);
    else void load().then(m => m.listenOnce([]));
  };
  const shown = flying ? pillText : text;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2" data-testid="one-field">
      {/* The assistant's last answer, a card over the field, as the Brief's
          Ask shows a turn (AskCard): the question at the right, the answer
          at the left with the reports it rests on. */}
      {last && !flying && (
        <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto rounded-[18px] bg-card p-3 shadow-[0_1px_4px_rgb(0_0_0/0.08)]" data-testid="strip-answer">
          <div className="flex items-center gap-2">
            <span className={cn("flex-1", GROUP_HEADING)}>Ask</span>
            {asking && (
              <Button variant="ghost" size="sm" className="text-tint" onClick={() => useAsk.getState().stop()} data-testid="strip-answer-stop">
                <Square className="size-3.5" /> Stop
              </Button>
            )}
            <CloseButton label="Dismiss the answer" className="-my-1 -mr-1" onClick={() => useAsk.getState().clear()} data-testid="strip-answer-close" />
          </div>
          <Suspense fallback={null}><Turn turn={last} /></Suspense>
        </div>
      )}
      {/* What a pilot asks first, and the planner's other screens, as
          chips while nothing is typed: how the rest is found without tabs. */}
      {focused && !text && !flying && suggestions.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" data-testid="strip-suggestions">
          {suggestions.map(words => (
            <Button
              key={words} variant="outline" size="sm" className={CHIP} data-testid="strip-suggestion"
              // Before the field's blur, so the chips are still here for the tap.
              onPointerDown={e => e.preventDefault()}
              onClick={() => void submit(words)}
            >
              {words}
            </Button>
          ))}
        </div>
      )}
      {problem && <p role="alert" className={cn("px-1 text-destructive-ink", TEXT.note)} data-testid="strip-problem">{problem}</p>}
      <div className="flex items-center gap-2">
        <Input
          ref={field} value={shown} readOnly={flying}
          onChange={e => setText(e.target.value)}
          placeholder={flying ? (pillListening ? "Listening…" : "Tap the mic and say it") : "Where to, or ask anything"}
          aria-label={flying ? "The radio" : "Where to, or ask anything"}
          enterKeyHint="go" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-testid="strip-field"
          onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => setFocused(false)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(text); } }}
          // 56 points round, as the canvas draws it (H1), over the sheet's
          // grey as the app's panel fields are (PANEL_FIELD_FILL).
          className={cn("h-14 rounded-full border-0 px-5", PANEL_FIELD_FILL, TEXT.row)}
        />
        <IconButton
          label={hearing || pillListening ? "Listening" : "Say it"} variant="default" size="icon-lg" onClick={hear} disabled={hearing || pillListening}
          className="size-12 shrink-0 rounded-full" data-testid="strip-mic"
        >
          <Mic className={cn("size-5", (hearing || pillListening) && "animate-pulse")} strokeWidth={2.4} />
        </IconButton>
      </div>
    </div>
  );
}
