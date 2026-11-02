import { useState } from "react";
import { Mic, Radio } from "lucide-react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { GLASS } from "./mapChrome";
import { Button } from "./ui/button";
import { api } from "../lib/api/client";
import { callToUs, useAtcRadio, useRadioActions, type Transmission } from "../lib/atcRadio";
import { clearedRoute, placesAsked, type Found } from "../lib/clearance";
import { callOf } from "../lib/heardCall";
import { TEXT } from "../lib/text";

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. */
const altitudeWords = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString("en-US")} ft`);

const capital = (words: string) => words.replace(/\b[a-z]/g, ch => ch.toUpperCase());

const CHIP = "rounded-full text-tint";

/**
 * What the app can do of something heard, a tap each -- Direct To the
 * place said (found near the route, flown from where the airplane is),
 * Enter Route for a clearance (its places found and the route it gives
 * entered, its SID and STAR picked, its altitude flown), Fly the
 * altitude, the frequency copied, the code shown. Nothing is done until
 * a chip is tapped; `done` puts what was heard away after one.
 */
function CallActions({ text, done }: { text: string; done: () => void }) {
  const { directTo, fly, enter, route } = useRadioActions();
  const near = useAtcRadio(s => s.near);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const heard = callOf(text, null);
  const { clearance } = heard;
  const routed = !!(clearance.limit || clearance.route.length || clearance.asFiled);
  const run = async (what: string, act: () => Promise<string | null>) => {
    setBusy(what);
    setProblem(null);
    const why = await act();
    setBusy(null);
    if (why) setProblem(why);
    else done();
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1 pr-2">
        {heard.direct && directTo && (
          <Button size="sm" variant="secondary" className={CHIP} disabled={!!busy} data-testid="radio-direct" onClick={() => void run("direct", () => directTo(heard.direct!))}>
            Direct To {/[a-z]/.test(heard.direct) ? capital(heard.direct) : heard.direct}
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
                const entered = clearedRoute(clearance, found, route);
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
      </div>
      {problem && <p className={cn("pt-1 pr-2 text-destructive-ink", TEXT.note)} role="status">{problem}</p>}
    </>
  );
}

/** Bars rising and falling while the microphone listens, as Siri's
 *  waveform; still under Reduce Motion. */
function Waveform() {
  return (
    <span className="flex h-5 items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i} className="h-full w-1 origin-center rounded-full bg-tint motion-safe:animate-[wave_0.9s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.12}s`, transform: "scaleY(0.4)" }}
        />
      ))}
    </span>
  );
}

/**
 * The map's microphone grown into a pill over the map, as Siri listens
 * (the owner's pick A, 2026-11-02): "Listening…" with the waveform, the
 * words typing in as they are said; at a pause or a second tap, what was
 * heard with the chips it offers (CallActions) and ✕. The Radio card,
 * the log, a tap on the words away.
 */
function RadioPill() {
  const pill = useAtcRadio(s => s.pill)!;
  const away = () => useAtcRadio.setState({ pill: null });
  return (
    <div className={cn(GLASS, "pointer-events-auto w-full max-w-md rounded-[22px] py-2 pr-1 pl-3")} data-testid="radio-pill">
      <div className="flex items-center gap-2">
        {pill.listening ? <Waveform /> : <Mic className="size-5 shrink-0 text-tint" aria-hidden="true" />}
        <button
          type="button" className={cn("min-w-0 flex-1 py-1 text-left outline-none focus-visible:underline", TEXT.detail)}
          aria-label="Open the radio's log" data-testid="radio-pill-text"
          onClick={() => useAtcRadio.setState({ cardOpen: true, cardText: pill.text || null })}
        >
          <span aria-live="polite" className={cn(!pill.text && "text-muted-foreground", pill.error && !pill.text && "text-caution-ink")}>
            {pill.text || pill.error || "Listening…"}
          </span>
        </button>
        {!pill.listening && <CloseButton label="Put away" onClick={away} data-testid="radio-pill-close" />}
      </div>
      {!pill.listening && pill.text && <CallActions text={pill.text} done={away} />}
    </div>
  );
}

/**
 * A call to us heard while the radio is listened to on and on (the Radio
 * card's Listen): what it asked, with its chips; ✕ puts it away.
 */
function RadioCall({ call }: { call: Transmission }) {
  const done = () => useAtcRadio.setState({ seen: call.id });
  return (
    <div className={cn(GLASS, "pointer-events-auto w-full max-w-md rounded-[22px] py-2 pr-1 pl-3")} role="alert" data-testid="radio-call">
      <div className="flex items-start gap-2">
        <Radio className="mt-1 size-5 shrink-0 text-tint" aria-hidden="true" />
        <p className={cn("min-w-0 flex-1 font-semibold", TEXT.detail)} data-testid="radio-call-text">{call.text}</p>
        <CloseButton label="Put away" onClick={done} data-testid="radio-call-close" />
      </div>
      <CallActions text={call.text} done={done} />
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
  const { listening, error, heard } = useAtcRadio();
  const lines = heard.slice(-2);
  return (
    <button
      type="button" data-testid="radio-captions"
      aria-label={listening ? "What the radio is saying: open the log" : "Radio: open the log"}
      onClick={() => useAtcRadio.setState(s => ({ cardOpen: true, cardText: [...s.heard].reverse().find(t => t.final)?.text ?? s.cardText }))}
      className={cn(GLASS, "pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-[22px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      <Mic className={cn("mt-0.5 size-5 shrink-0", listening ? "animate-pulse text-tint" : "text-muted-foreground")} aria-hidden="true" />
      <span className={cn("flex min-w-0 flex-1 flex-col", TEXT.detail)} aria-live="polite">
        {error && <span className="text-caution-ink">{error}</span>}
        {!error && !lines.length && <span className="text-muted-foreground">Listening to the radio…</span>}
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
  const pill = useAtcRadio(s => s.pill !== null);
  const call = useAtcRadio(callToUs);
  const captions = useAtcRadio(s => s.mode === "radio" || (!!s.error && s.mode !== "once" && s.pill === null));
  return (
    <>
      {pill && <RadioPill />}
      {call && <RadioCall key={call.id} call={call} />}
      {captions && <RadioCaptions />}
    </>
  );
}
