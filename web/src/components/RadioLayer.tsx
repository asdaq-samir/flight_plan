import { useState } from "react";
import { Mic, Radio } from "lucide-react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { GLASS } from "./mapChrome";
import { Button } from "./ui/button";
import { callToUs, useAtcRadio, useRadioActions, type Transmission } from "../lib/atcRadio";
import { callOf } from "../lib/heardCall";
import { TEXT } from "../lib/text";

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. */
const altitudeWords = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString("en-US")} ft`);

const capital = (words: string) => words.replace(/\b[a-z]/g, ch => ch.toUpperCase());

/**
 * A call to us (lib/heardCall), over the map with what it asked and a
 * tap for each thing the app can do of it: Direct To the place said,
 * Enter Route for a clearance (its card, to read it first), Fly the
 * altitude, the frequency copied, the code shown. Nothing is done until
 * it is tapped, and the pilot still reads back and flies it; ✕ puts it
 * away.
 */
function RadioCall({ call }: { call: Transmission }) {
  const { directTo, fly } = useRadioActions();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const heard = callOf(call.text, null);
  const { clearance } = heard;
  const done = () => useAtcRadio.setState({ seen: call.id });
  const routed = !!(clearance.limit || clearance.route.length);
  return (
    <div className={cn(GLASS, "pointer-events-auto w-full max-w-md rounded-[22px] py-2 pr-1 pl-3")} role="alert" data-testid="radio-call">
      <div className="flex items-start gap-2">
        <Radio className="mt-1 size-5 shrink-0 text-tint" aria-hidden="true" />
        <p className={cn("min-w-0 flex-1 font-semibold", TEXT.detail)} data-testid="radio-call-text">{call.text}</p>
        <CloseButton label="Put away" onClick={done} data-testid="radio-call-close" />
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1 pr-2">
        {heard.direct && directTo && (
          <Button
            size="sm" variant="secondary" className="rounded-full text-tint" disabled={busy} data-testid="radio-call-direct"
            onClick={async () => {
              setBusy(true);
              const why = await directTo(heard.direct!);
              setBusy(false);
              if (why) setProblem(why);
              else done();
            }}
          >
            Direct To {/[a-z]/.test(heard.direct) ? capital(heard.direct) : heard.direct}
          </Button>
        )}
        {routed && (
          <Button
            size="sm" variant="secondary" className="rounded-full text-tint" data-testid="radio-call-route"
            onClick={() => useAtcRadio.setState({ cardOpen: true, cardText: call.text, seen: call.id })}
          >
            Enter Route
          </Button>
        )}
        {clearance.maintainFt !== null && !clearance.vfr && fly && (
          <Button
            size="sm" variant="secondary" className="rounded-full text-tint" data-testid="radio-call-fly"
            onClick={() => { fly(clearance.maintainFt!); done(); }}
          >
            Fly {altitudeWords(clearance.maintainFt)}
          </Button>
        )}
        {clearance.frequency && (
          <Button
            size="sm" variant="secondary" className="rounded-full text-tint" data-testid="radio-call-frequency"
            onClick={() => void navigator.clipboard?.writeText(clearance.frequency!).catch(() => {})}
          >
            Copy {clearance.frequency}
          </Button>
        )}
        {clearance.squawk && <span className={cn("font-semibold", TEXT.detail)}>Squawk {clearance.squawk}</span>}
      </div>
      {problem && <p className={cn("pt-1 pr-2 text-destructive-ink", TEXT.note)} role="status">{problem}</p>}
    </div>
  );
}

/**
 * What the radio is saying, as it is said, over the map while the app
 * listens: the last transmission settled and the one being said, a call
 * to us in the tint, as iOS's Live Captions sit over what is under them.
 * A tap opens the clearance card with the whole log.
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

/** The radio's lines over the map (MapBanners): a call to us, then the
 *  captions while listening. In a chunk of its own, loaded once the
 *  radio is first listened to. */
export default function RadioLayer() {
  const call = useAtcRadio(callToUs);
  const shown = useAtcRadio(s => s.listening || !!s.error);
  return (
    <>
      {call && <RadioCall key={call.id} call={call} />}
      {shown && <RadioCaptions />}
    </>
  );
}
