import { useEffect, useMemo, useState } from "react";
import { Mic, Radio } from "lucide-react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { GLASS } from "./mapChrome";
import Waveform from "./Waveform";
import { Button } from "./ui/button";
import { api } from "../lib/api/client";
import { callToUs, chosenOutside, heardThrough, lostWords, useAtcRadio, useRadioActions, type Transmission } from "../lib/atcRadio";
import { clearedRoute, heardAny, placesAsked, readClearance, type Found } from "../lib/clearance";
import { stopwatch } from "../lib/diversion";
import { callOf } from "../lib/heardCall";
import { metarWords } from "../lib/metarWords";
import { commandsOf } from "../lib/pilotCommand";
import { altitudeWords, readbackCheck } from "../lib/readback";
import { say } from "../lib/speech";
import { TEXT } from "../lib/text";
import { useAsk } from "../features/plan/components/ask/useAsk";

const capital = (words: string) => words.replace(/\b[a-z]/g, ch => ch.toUpperCase());
/** A place's words as a chip says them: spelled idents as they are. */
const named = (words: string) => (/[a-z]/.test(words) ? capital(words) : words);

const CHIP = "rounded-full text-tint";

/** The listening code (lib/atcListening), fetched as the pill comes so a
 *  chip's tap starts the readback at once: Safari lets a page listen only
 *  straight from the tap (RadioButton loads it the same way). */
let listening: typeof import("../lib/atcListening") | null = null;
const load = () => import("../lib/atcListening").then(m => (listening = m));

/**
 * What the app can do of something heard, a tap each -- Direct To the
 * place said (found near the route, flown from where the airplane is),
 * Enter Route for a clearance (its places found and the route it gives
 * entered, its SID and STAR picked, its altitude flown), Fly the
 * altitude, the frequency copied, the code shown; and of the pilot's own
 * words (lib/pilotCommand): the nearest airports, an approach's page,
 * the weather at a field said aloud, a timer, and a clearance read back
 * and checked (lib/readback). Nothing is done until a chip is tapped;
 * `done` puts what was heard away after one.
 */
function CallActions({ text, done, own = false }: {
  text: string;
  done: () => void;
  /** The pilot's own words from the map's microphone (RadioPill), not a
   *  call heard on the radio: words that are no command the app knows
   *  are offered to the assistant. */
  own?: boolean;
}) {
  const { directTo, fly, enter, route, nearest, showProcedure, planTo } = useRadioActions();
  const near = useAtcRadio(s => s.near);
  const mode = useAtcRadio(s => s.mode);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** What a chip brought, kept in the pill: a field's report. */
  const [note, setNote] = useState<string | null>(null);
  // The question the Ask chip sent, and its answer as it comes (useAsk):
  // read aloud as it ends, and shown here in the pill meanwhile.
  const [askedId, setAskedId] = useState<number | null>(null);
  const asked = useAsk(s => (askedId === null ? null : s.turns.find(t => t.id === askedId) ?? null));
  const heard = callOf(text, null);
  const { clearance } = heard;
  const commands = useMemo(() => commandsOf(text), [text]);
  // No command found and no clearance heard: a question for the assistant.
  const askable = own && !commands.length && !heard.direct && !heardAny(clearance);
  const askIt = () => {
    void useAsk.getState().ask(text, { speak: true });
    setAskedId(useAsk.getState().turns.at(-1)?.id ?? null);
  };
  const altitude = commands.find(c => c.kind === "altitude");
  const procedure = commands.find(c => c.kind === "procedure");
  const weather = commands.find(c => c.kind === "weather");
  const timer = commands.find(c => c.kind === "timer");
  const destination = commands.find(c => c.kind === "destination");
  const routed = !!(clearance.limit || clearance.route.length || clearance.asFiled);
  const run = async (what: string, act: () => Promise<string | null>) => {
    setBusy(what);
    setProblem(null);
    const why = await act();
    setBusy(null);
    if (why) setProblem(why);
    else done();
  };
  // The field a command names, found by its words near the route; none
  // named, the destination.
  const fieldOf = async (field: string | null): Promise<{ ident: string } | { why: string }> => {
    if (!field) return route.dest ? { ident: route.dest } : { why: "No destination: plan a route or name the field." };
    try {
      const found = await api.clearancePlaces({ limit: field, route: [], near, dep: route.dep || null, dest: route.dest || null });
      const ident = found.limit?.kind === "airport" ? found.limit.ident : null;
      return ident ? { ident } : { why: `“${field}” was not found near the route.` };
    } catch {
      return { why: "The field could not be looked up; check the connection." };
    }
  };
  const tellWeather = async (field: string | null) => {
    setBusy("weather");
    setProblem(null);
    const at = await fieldOf(field);
    if ("why" in at) {
      setBusy(null);
      setProblem(at.why);
      return;
    }
    try {
      const airport = await api.airport(at.ident);
      const metar = airport.metar;
      if (!metar?.raw) setNote(`No report at ${at.ident}.`);
      else {
        setNote(`${at.ident}: ${metar.raw}`);
        say(metarWords(airport.name || at.ident, metar));
      }
    } catch {
      setProblem(`${at.ident}'s weather could not be had; check the connection.`);
    }
    setBusy(null);
  };
  const setTimer = (from: number | null) => useAtcRadio.setState(s => ({ pill: s.pill && { ...s.pill, timerFrom: from } }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1 pr-2">
        {heard.direct && directTo && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-direct" onClick={() => void run("direct", () => directTo(heard.direct!))}>
            Direct To {named(heard.direct)}
          </Button>
        )}
        {commands.some(c => c.kind === "nearest") && nearest && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-nearest" onClick={() => { nearest(); done(); }}>
            Nearest Airports
          </Button>
        )}
        {/* "Plan a trip to Las Vegas": a route there, the chip saying so
            where it would replace the route there is (the owner's
            screenshot, 2026-11-03, the pill offering nothing for it). */}
        {destination && planTo && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-plan" onClick={() => void run("plan", () => planTo(destination.place))}>
            {route.dest ? "Replace the route: plan to " : "Plan to "}{named(destination.place)}
          </Button>
        )}
        {altitude && clearance.maintainFt === null && fly && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-fly" onClick={() => { fly(altitude.ft); done(); }}>
            Fly {altitudeWords(altitude.ft)}
          </Button>
        )}
        {procedure && showProcedure && (
          <Button
            size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-procedure"
            onClick={() => void run("procedure", async () => {
              const at = await fieldOf(procedure.field);
              return "why" in at ? at.why : showProcedure(at.ident, procedure.approach, procedure.runway);
            })}
          >
            {procedure.approach}{procedure.runway ? ` ${procedure.runway}` : ""}{procedure.field ? ` at ${named(procedure.field)}` : ""}
          </Button>
        )}
        {weather && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-weather" onClick={() => void tellWeather(weather.field)}>
            Weather{weather.field ? ` at ${named(weather.field)}` : ""}
          </Button>
        )}
        {timer && (
          <Button size="sm" variant="secondary" className={CHIP} data-testid="radio-timer" onClick={() => setTimer(timer.start ? Date.now() : null)}>
            {timer.start ? "Start Timer" : "Stop Timer"}
          </Button>
        )}
        {heardAny(clearance) && mode === "once" && (
          <Button
            size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-readback"
            onClick={() => (listening ? void listening.listenOnce([], text) : void load().then(m => m.listenOnce([], text)))}
          >
            Read Back
          </Button>
        )}
        {routed && enter && (
          <Button
            size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-route"
            onClick={() => void run("route", async () => {
              const asked = placesAsked(clearance);
              try {
                const wants = asked.limit || asked.route.length || asked.departure || asked.arrival;
                const found = wants ? ((await api.clearancePlaces({ ...asked, near, dep: route.dep || null, dest: route.dest || null })) as Found) : {};
                const unfound = [found.limit, ...(found.route ?? []).flat()].filter(p => p && !p.ident).map(p => `“${p!.said}”`);
                if (unfound.length) return `${unfound.join(", ")} not found: open the log to check it.`;
                const entered = clearedRoute(text, found, route);
                enter(entered.route, entered.typed, clearance.vfr ? null : clearance.expectFt ?? clearance.maintainFt);
                return null;
              } catch {
                return "The places in it could not be looked up; check the connection.";
              }
            })}
          >
            Enter Route
          </Button>
        )}
        {clearance.maintainFt !== null && !clearance.vfr && fly && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-fly" onClick={() => { fly(clearance.maintainFt!); done(); }}>
            Fly {altitudeWords(clearance.maintainFt)}
          </Button>
        )}
        {clearance.frequency && (
          <Button size="sm" variant="secondary" className={CHIP} data-testid="radio-frequency"
            onClick={() => void navigator.clipboard?.writeText(clearance.frequency!).catch(() => {})}>
            Copy {clearance.frequency}
          </Button>
        )}
        {clearance.squawk && <span className={cn("font-semibold", TEXT.detail)}>Squawk {clearance.squawk}</span>}
        {askable && !asked && (
          <Button size="sm" variant="secondary" className={cn(CHIP, "max-w-full")} disabled={!!busy} data-testid="radio-ask" onClick={askIt}>
            <span className="truncate">Ask: “{text}”</span>
          </Button>
        )}
      </div>
      {asked && (
        <p className={cn("pt-1 pr-2 tabular-nums whitespace-pre-wrap", asked.error ? "text-destructive-ink" : "", TEXT.note)} role="status" data-testid="radio-ask-answer">
          {asked.status ? `${asked.status}…` : asked.error ?? asked.answer}
        </p>
      )}
      {note && <p className={cn("pt-1 pr-2 font-mono", TEXT.note)} data-testid="radio-note">{note}</p>}
      {problem && <p className={cn("pt-1 pr-2 text-destructive-ink", TEXT.note)} role="status">{problem}</p>}
    </>
  );
}

/** A clearance's readback checked against it (lib/readback): what was
 *  missed or said differently as a warning line, never a stop. */
function ReadbackLine({ cleared, said }: { cleared: string; said: string }) {
  const { items, words } = useMemo(() => readbackCheck(cleared, said), [cleared, said]);
  return (
    <p className={cn("pt-1 pr-2", items.length ? "text-caution-ink" : "text-muted-foreground", TEXT.note)} role="status" data-testid="radio-readback-check">
      {words}
    </p>
  );
}

/** The timer a pilot started by voice, counting in the pill until stopped. */
function Timer({ from, onStop }: { from: number; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  return (
    <div className="flex items-center gap-2 pt-1 pr-2">
      <span className={cn("font-semibold tabular-nums", TEXT.detail)} data-testid="radio-timer-time">Timer {stopwatch(Math.max(0, now - from))}</span>
      <Button size="sm" variant="secondary" className={CHIP} onClick={onStop} data-testid="radio-timer-stop">Stop</Button>
    </div>
  );
}

/** Bars rising and falling while the microphone listens, as Siri's
 *  waveform; still under Reduce Motion. */
/**
 * The map's microphone grown into a pill, as Siri listens (the owner's
 * pick A, 2026-11-02), in the mic's own circle, which widens into it
 * (MapControls; the owner, 2026-11-03: the button and the pill were two
 * things apart, one at the bottom left and one at the top): the mic's
 * glyph becomes the waveform, "Listening…" and then the words typing in
 * as they are said beside it; at a pause or a second tap, what was heard
 * with the chips it offers (CallActions) and ✕, and the circle again
 * once put away. The Radio card, the log, a tap on the words away.
 */
export function RadioPill() {
  const pill = useAtcRadio(s => s.pill)!;
  const input = useAtcRadio(s => s.input);
  const away = () => useAtcRadio.setState({ pill: null });
  useEffect(() => { void load(); }, []);
  const readback = pill.readbackOf ?? null;
  // The input chosen gone while listening: said in the line, as an error is.
  const lost = pill.listening && input?.lost ? lostWords(input) : null;
  // An outside input by its name (lib/audioInput), the owner having asked
  // whether the mic can hear the radio itself (2026-11-04): heard through
  // where the recognizer is known to take it, else only chosen (lib/
  // atcRadio's heardThrough); the phone's own microphone leaves the words
  // as they were.
  const name = heardThrough(input);
  const chosen = chosenOutside(input);
  const waiting = readback ? "Read it back…" : name ? `Listening through ${name}…` : chosen ? `Listening with ${chosen} chosen…` : "Listening…";
  return (
    <div className="min-w-0 py-1 px-1" data-testid="radio-pill">
      <div className="flex items-center gap-2">
        <button
          type="button" className={cn("min-w-0 flex-1 py-1 text-left outline-none focus-visible:underline", TEXT.detail)}
          aria-label="Open the radio's log" data-testid="radio-pill-text"
          onClick={() => useAtcRadio.setState({ cardOpen: true, cardText: pill.text || null })}
        >
          <span aria-live="polite" className={cn(!pill.text && "text-muted-foreground", (pill.error || lost) && !pill.text && "text-caution-ink")}>
            {pill.text || pill.error || lost || waiting}
          </span>
        </button>
        {!pill.listening && <CloseButton label="Put away" onClick={away} data-testid="radio-pill-close" />}
      </div>
      {/* A readback heard: how it matched, in place of the chips. */}
      {!pill.listening && pill.text && (readback ? <ReadbackLine cleared={readback} said={pill.text} /> : <CallActions text={pill.text} done={away} own />)}
      {pill.timerFrom != null && <Timer from={pill.timerFrom} onStop={() => useAtcRadio.setState(s => ({ pill: s.pill && { ...s.pill, timerFrom: null } }))} />}
    </div>
  );
}

/**
 * A call to us heard while the radio is listened to on and on (the Radio
 * card's Listen): what it asked, with its chips; ✕ puts it away.
 */
function RadioCall({ call }: { call: Transmission }) {
  const done = () => useAtcRadio.setState({ seen: call.id });
  // With the radio listened to on and on, the pilot's readback is the
  // next transmission heard with a clearance's items in it, not to us:
  // checked against the call as it settles (lib/readback).
  const heard = useAtcRadio(s => s.heard);
  const readback = useMemo(
    () => (heardAny(readClearance(call.text)) ? heard.find(t => t.id > call.id && t.final && !t.forUs && heardAny(readClearance(t.text))) ?? null : null),
    [heard, call],
  );
  return (
    <div className={cn(GLASS, "pointer-events-auto w-full max-w-md rounded-[22px] py-2 pr-1 pl-3")} role="alert" data-testid="radio-call">
      <div className="flex items-start gap-2">
        <Radio className="mt-1 size-5 shrink-0 text-tint" aria-hidden="true" />
        <p className={cn("min-w-0 flex-1 font-semibold", TEXT.detail)} data-testid="radio-call-text">{call.text}</p>
        <CloseButton label="Put away" onClick={done} data-testid="radio-call-close" />
      </div>
      <CallActions text={call.text} done={done} />
      {readback && <ReadbackLine cleared={call.text} said={readback.text} />}
    </div>
  );
}

/**
 * What the radio is saying, as it is said, over the map while it is
 * listened to on and on: the last transmission settled and the one being
 * said, a call to us in the tint, as iOS's Live Captions sit over what is
 * under them. A tap opens the log.
 */
function RadioCaptions() {
  const { listening, error, heard, input } = useAtcRadio();
  const lines = heard.slice(-2);
  const name = heardThrough(input);
  const chosen = chosenOutside(input);
  const lost = input?.lost ? lostWords(input) : null;
  return (
    <button
      type="button" data-testid="radio-captions"
      aria-label={listening ? "What the radio is saying: open the log" : "Radio: open the log"}
      onClick={() => useAtcRadio.setState(s => ({ cardOpen: true, cardText: [...s.heard].reverse().find(t => t.final)?.text ?? s.cardText }))}
      className={cn(GLASS, "pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-[22px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {/* While an input is metered its level, in the glyph's place and
          size; the bars narrowed to fit the glyph's 20 points. */}
      {listening && input && !input.lost
        ? <Waveform live className="mt-0.5 size-5 shrink-0 justify-center [&>span]:w-0.5" />
        : <Mic className={cn("mt-0.5 size-5 shrink-0", listening ? "animate-pulse text-tint" : "text-muted-foreground")} aria-hidden="true" />}
      <span className={cn("flex min-w-0 flex-1 flex-col", TEXT.detail)} aria-live="polite">
        {error && <span className="text-caution-ink">{error}</span>}
        {!error && lost && <span className="text-caution-ink" data-testid="radio-captions-lost">{lost}</span>}
        {!error && !lost && !lines.length && (
          <span className="text-muted-foreground">
            {name ? `Listening to the radio through ${name}…` : chosen ? `Listening to the radio with ${chosen} chosen…` : "Listening to the radio…"}
          </span>
        )}
        {lines.map(t => (
          <span key={t.id} className={cn("line-clamp-2", t.forUs ? "font-semibold text-tint" : "text-foreground", !t.final && "opacity-80")}>
            {t.text}
          </span>
        ))}
      </span>
    </button>
  );
}

/** The radio's lines over the map (MapBanners): the microphone's pill, a
 *  call to us, and the captions while listened to on and on. In a chunk
 *  of its own, loaded once the radio is first listened to. */
export default function RadioLayer() {
  const call = useAtcRadio(callToUs);
  const captions = useAtcRadio(s => s.mode === "radio" || (!!s.error && s.mode !== "once" && s.pill === null));
  // The microphone's pill is the mic's own circle grown (RadioPill, in
  // MapControls), not a line here.
  return (
    <>
      {call && <RadioCall key={call.id} call={call} />}
      {captions && <RadioCaptions />}
    </>
  );
}
