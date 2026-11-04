import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Search, Sparkles, Square } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../components/CloseButton";
import IconButton from "../../components/IconButton";
import { GLASS } from "../../components/mapChrome";
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

/** What a pilot asks the assistant first, as chips while the field is in
 *  ask mode and empty (the Ask pill, `ask`). */
const ASK_CHIPS = ["Can I go?", "What's the weather on the way?", "Where should I stop for fuel?", "What should I watch for?"];

/**
 * The one field at the foot of the chart, in every state of the sheet
 * (MapPanel's `foot`), as Maps' pill is (the owner's screenshot,
 * 2026-11-04: "Why don't we do pill like this? With search bar, mic and
 * person"): one row -- a glass field, 52 points tall, the magnifier at
 * its left, "Where to, or ask", the microphone inside it at its right in
 * the tint -- and beside it the pilot's round avatar (`avatar`,
 * ProfileButton), 44 points, its menu the pilot's screens. The pill is
 * the grabber and this row; the ribbon is the sheet's first row from
 * half way up (StripRibbon). What the field takes is read by readField
 * -- idents are a route, a name a place, a screen's word that screen,
 * anything else a question for the assistant -- and done by the planner
 * (`onLine`), which answers why not where it cannot, said under the
 * field (lib/problems' rule: where it happens, never a toast).
 * Suggestions as chips while it is focused and empty, each one tap. The
 * assistant's last answer is a card over the field (AskCard's Turn),
 * its ✕ forgetting the conversation. Typed into, the field's own clear
 * takes the microphone's place (Input), as Maps' does.
 *
 * The microphone listens once, as the Brief's Ask does (lib/atcListening
 * listenOnce): the words come here as the pause ends them, handled as
 * typed. In the air the field is the radio's: the pill's words in it as
 * they come, nothing typed, and the words done the same way once said --
 * the pilot's commands first (PlanWorkspace's fieldLine: an altitude,
 * direct to a place, a procedure), the rest asked -- since the map's
 * microphone and its pill of chips (RadioLayer) are not in this layout.
 *
 * Over the tab bar (FieldTabsBar, the owner's third screen of
 * 2026-11-04, Target's way) the field has an Ask pill inside it at its
 * right end (`ask`): the sparkle and "Ask" in the tint, a 32-point
 * capsule with a hairline outline and its 44-point area, one tint and no
 * gradient, as every tappable thing is. Tapped, the field is in ask
 * mode -- the pill filled, the sparkle in the magnifier's place -- and
 * whatever is typed or said goes to the assistant, never read as a route;
 * tapped again, the field is its own again.
 */
export default function OneField({ suggestions, flying = false, onLine, onFocus, avatar, ask = false }: {
  suggestions: string[];
  flying?: boolean;
  /** The Ask pill inside the field, at its right end. */
  ask?: boolean;
  /** The line read (readField) and as typed: null once done, else why not. */
  onLine: (command: FieldCommand, text: string) => Promise<string | null>;
  /** The field focused: the sheet up from the pill, clear of the keyboard. */
  onFocus?: () => void;
  /** The pilot's avatar at the row's right (ProfileButton). */
  avatar?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [askMode, setAskMode] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const last = useAsk(s => s.turns.at(-1) ?? null);
  const asking = useAsk(s => s.busy);
  const pillText = useAtcRadio(s => s.pill?.text ?? "");
  const pillListening = useAtcRadio(s => !!s.pill?.listening);
  useEffect(() => { void load(); }, []);
  // In ask mode the line is the assistant's whatever it says; else read
  // as a route, a place, a screen or a question (readField).
  const submit = async (line: string) => {
    const command = askMode ? (line.trim() ? { kind: "ask" as const, question: line.trim() } : null) : readField(line);
    if (!command || busy) return;
    setProblem(null);
    setBusy(true);
    setText("");
    const why = await onLine(command, line);
    setBusy(false);
    if (why) setProblem(why);
  };
  // The microphone's words once the pause ends them, handled as typed and
  // the pill put away -- in the air too, where the field shows them as
  // they come (`shown`).
  useEffect(() => {
    if (!hearing) return;
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
  }, [hearing]);
  const hear = () => {
    setProblem(null);
    setHearing(true);
    if (listening) void listening.listenOnce([]);
    else void load().then(m => m.listenOnce([]));
  };
  const shown = flying ? pillText : text;
  const listens = hearing || pillListening;
  // The microphone in the field while nothing is typed; typed into, the
  // field's own clear is there (Input). In the air the words are the
  // radio's, so the microphone stays.
  const micShown = flying || !shown;
  // The Ask pill on the ground only: in the air the field is the radio's.
  const askShown = ask && !flying;
  const inAsk = askShown && askMode;
  const toggleAsk = () => {
    setProblem(null);
    setAskMode(on => !on);
    if (!askMode) field.current?.focus();
  };
  const chips = inAsk ? ASK_CHIPS : suggestions;
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
      {focused && !text && !flying && chips.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" data-testid="strip-suggestions">
          {chips.map(words => (
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
        <div className="relative min-w-0 flex-1">
          {inAsk ? (
            <Sparkles className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-tint" aria-hidden="true" strokeWidth={2.25} />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" strokeWidth={2.25} />
          )}
          <Input
            ref={field} value={shown} readOnly={flying}
            onChange={e => setText(e.target.value)}
            placeholder={flying ? (pillListening ? "Listening…" : "Tap the mic and say it") : inAsk ? "Ask about this flight" : "Where to, or ask"}
            aria-label={flying ? "The radio" : inAsk ? "Ask anything about this flight" : "Where to, or ask anything"}
            enterKeyHint="go" autoComplete="off" autoCapitalize={inAsk ? "sentences" : "characters"} autoCorrect="off" spellCheck={false} data-testid="strip-field"
            data-ask={inAsk ? "" : undefined}
            onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => setFocused(false)}
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(text); } }}
            // 52 points tall, round, in the glass the pill itself is drawn
            // in (GLASS), the magnifier's room at its left and the
            // microphone's -- and the Ask pill's -- at its right.
            className={cn("h-13 rounded-full border-0 pl-11 shadow-none", askShown ? (micShown ? "pr-[8.25rem]" : "pr-[5.5rem]") : micShown ? "pr-12" : "pr-4", GLASS, TEXT.row)}
          />
          {/* The microphone, and with it the Ask pill where the field has
              one: six apart, so the two 44-point areas meet. */}
          <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
            {micShown && (
              <IconButton
                label={listens ? "Listening" : "Say it"} size="icon-lg" onClick={hear} disabled={listens}
                className="rounded-full text-tint" data-testid="strip-mic"
              >
                <Mic className={cn("size-5", listens && "animate-pulse")} strokeWidth={2.25} />
              </IconButton>
            )}
            {askShown && (
              <button
                type="button" aria-pressed={askMode} data-testid="field-ask"
                className={cn(
                  "relative flex h-8 shrink-0 items-center gap-1 rounded-full border border-tint px-3 font-semibold after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']",
                  askMode ? "bg-primary text-primary-foreground" : "text-tint", TEXT.detail,
                )}
                // Before the field's blur, so the chips stay for the tap.
                onPointerDown={e => e.preventDefault()}
                onClick={toggleAsk}
              >
                <Sparkles className="size-4" strokeWidth={2.25} aria-hidden="true" />
                Ask
              </button>
            )}
          </div>
        </div>
        {/* The avatar's taps its own: on the pill a finger on the foot drags
            the sheet and a tap opens it (MapPanel), which the menu's
            opening is not. */}
        {avatar && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- not a control: the avatar's own button is inside
          <div className="shrink-0" data-testid="strip-avatar" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            {avatar}
          </div>
        )}
      </div>
    </div>
  );
}
