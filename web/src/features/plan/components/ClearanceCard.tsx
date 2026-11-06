import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Mic, Square, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../../components/IconButton";
import ListenThrough from "../../../components/ListenThrough";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Button } from "../../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { FieldError } from "../../../components/ui/field";
import { Textarea } from "../../../components/ui/textarea";
import { api } from "../../../lib/api/client";
import {
  clearedRoute, heardAny, placesAsked, readClearance, routeDifference,
  type Clearance, type ClearedItem, type Found, type FoundPlace,
} from "../../../lib/clearance";
import { canListen } from "../../../lib/listen";
import { heardThrough, useAtcRadio, useRadioActions, type PlannedRoute } from "../../../lib/atcRadio";
import { listenOnce, startRadio, stopRadio } from "../../../lib/atcListening";
import { callPattern } from "../../../lib/heardCall";
import { altitudeWords, clearanceParts, readbackCheck, readbackLines } from "../../../lib/readback";
import { TEXT } from "../../../lib/text";

/** The words once they have stopped changing for a moment, so the
 *  planner is not asked at each letter typed or word heard. */
function useSettled(text: string, ms: number): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(text), ms);
    return () => window.clearTimeout(id);
  }, [text, ms]);
  return settled;
}

const capital = (words: string) => words.replace(/\b[a-z]/g, ch => ch.toUpperCase());
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A clearance as a recognizer writes one, for the empty field's example:
 *  fixtures/clearances.json's Duluth clearance, the form AIM 4-4-3 gives,
 *  and the bare read back of it a pilot gives (fixtures/readbacks.json). */
const EXAMPLE = "“Cleared to the Duluth airport via Gopher then as filed, maintain three thousand, departure one two five point three five, squawk four five two one.”";
const EXAMPLE_READBACK = "“Duluth, Gopher, three thousand, one two five point three five, four five two one, Skyhawk three alpha bravo.”";

/** A place as found: its ident, or the words said where nothing was
 *  found, in amber where it was found by its sound only, for the pilot to
 *  check. */
function Place({ place }: { place: FoundPlace }) {
  if (!place.ident) return <span className="text-destructive" title="Not found">“{place.said}”?</span>;
  return (
    <span className={cn(!place.sure && "text-amber-600 dark:text-amber-400")} title={place.name ?? undefined}>
      {place.ident}{!place.sure && "?"}
    </span>
  );
}

/** The route as cleared, its parts in order, each as found. */
function RouteWords({ items, asFiled, found }: { items: ClearedItem[]; asFiled: boolean; found: Found | undefined }) {
  const parts: ReactNode[] = [];
  let run = 0;
  for (const [i, item] of items.entries()) {
    if (item.kind === "vectors") parts.push("Radar vectors");
    else if (item.kind === "heading") parts.push(`Heading ${String(item.degrees).padStart(3, "0")}`);
    else if (item.kind === "airway") parts.push(item.ident);
    else if (item.kind === "places") {
      const places = found?.route?.[run++] ?? [{ said: item.said, sure: true, ident: item.said.toUpperCase() }];
      parts.push(...places.map((p, k) => <Place key={`${i}-${k}`} place={p} />));
    } else {
      const picked = found?.[item.kind];
      parts.push(picked
        ? `${picked.id}${picked.transition ? `.${picked.transition}` : ""}`
        : `${capital(item.name)} ${item.number} ${item.kind}${item.transition ? `, ${capital(item.transition)} transition` : ""}`);
    }
  }
  if (asFiled) parts.push("as filed");
  return <>{parts.map((part, i) => <span key={i}>{i > 0 && " → "}{part}</span>)}</>;
}

/** The altitudes in one line, as the iPhone writes them: "Maintain
 *  5,000 ft, expect 9,000 ft 10 min after departure". */
function altitudeLine(c: Clearance): string | null {
  const parts: string[] = [];
  if (c.maintainFt !== null) parts.push(`maintain ${c.vfr ? "VFR " : ""}${c.maintainLimit ? `${c.maintainLimit} ` : ""}${altitudeWords(c.maintainFt)}`);
  if (c.expectFt !== null) parts.push(`expect ${altitudeWords(c.expectFt)}${c.expectMin ? ` ${c.expectMin} min after departure` : ""}`);
  if (!parts.length) return null;
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** A route as one line: its ends and the points between. */
const routeLine = (r: PlannedRoute) => [r.dep, ...r.stops, r.dest].filter(Boolean).join(" → ") || "none";

/** One named line of a row's detail: a CRAFT item, a route, an altitude. */
function Line({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted-foreground">{name}</span>
      <span className="min-w-0 font-semibold">{children}</span>
    </div>
  );
}

/**
 * One of the card's four rows: its name at the left, where it stands at
 * the right, a control of its own beside it (a microphone, Enter Route)
 * and its detail folded under, opened by a tap on the row (shadcn's
 * Collapsible on a ListRow, as the airport card folds its fuel remarks).
 * The row's own height is its hit area (a ListRow is 44 at the least);
 * the control beside it gets its 44 from a pseudo-element.
 */
function Step({ id, title, state, open, onOpenChange, control, children }: {
  id: string;
  title: string;
  state: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center gap-2 pr-2">
        <CollapsibleTrigger asChild>
          <ListRow title={title} value={<span data-testid={`clearance-state-${id}`}>{state}</span>} chevron data-testid={`clearance-row-${id}`} className="min-w-0 flex-1" />
        </CollapsibleTrigger>
        {control}
      </div>
      <CollapsibleContent className={cn("flex flex-col gap-2 px-3 pb-3", TEXT.detail)} data-testid={`clearance-detail-${id}`}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A tick for what was read back or matches, a mark for what was not,
 *  each named for VoiceOver as the iPhone names them. */
function Verdict({ ok, said, children }: { ok: boolean; said: [ok: string, notOk: string]; children: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2", !ok && "text-caution-ink")}>
      {ok
        ? <Check className="mt-0.5 size-4 shrink-0 text-green-700 dark:text-green-400" aria-label={said[0]} />
        : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-label={said[1]} />}
      <span>{children}</span>
    </div>
  );
}

/** The microphone beside a row, in the tint, its 44-point hit area a
 *  pseudo-element round the stock 36; and the small button's round its
 *  32. */
const ROW_MIC = "relative shrink-0 after:absolute after:-inset-1 after:content-['']";
const ROW_BUTTON = "relative shrink-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";
const NOT_YET = <span className="text-muted-foreground">Not yet</span>;

/**
 * The clearance step as one card, the way the iPhone has it (ClearanceSheet,
 * the owner's canvas of 2026-11-03): four rows in the order a clearance
 * is worked -- Hear, Read back, Enter, Compare -- each one line at rest
 * with where it stands at the right, and its detail under a tap: the
 * clearance as heard (typed or off the radio) laid out as CRAFT (cleared
 * to, route, altitude, frequency, transponder; AIM 4-4-3 lists what a
 * clearance holds, in that order), the pilot's read back checked line by
 * line by the engine (lib/readback, AIM 4-4-7 b), the route the clearance
 * gives and the altitude it flies, and that route held against the one
 * filed (routeDifference). Enter Route is the one tap that changes the
 * plan: nothing heard goes in before it.
 */
export default function ClearanceCard({ onDone }: {
  /** The card put away, the route entered. */
  onDone: () => void;
}) {
  const { listening, error, heard, tail, near, mode, input } = useAtcRadio();
  const route = useRadioActions(s => s.route);
  const enter = useRadioActions(s => s.enter);
  const typed = useAtcRadio(s => s.cardText) ?? "";
  // While the radio is listened to on and on the card reads the newest
  // transmission settled, until the pilot picks one from the log or types.
  const [following, setFollowing] = useState(true);
  const newest = [...heard].reverse().find(t => t.final);
  const text = listening && following && newest ? newest.text : typed;
  const pick = (picked: string) => {
    setFollowing(false);
    useAtcRadio.setState({ cardText: picked });
  };
  // The rows open: Hear from the start where there is nothing yet, since
  // the field to type in is under it; the rest as the pilot taps them.
  const [open, setOpen] = useState(() => ({ hear: !typed.trim(), readback: false, enter: false, compare: false }));
  const openRow = (id: keyof typeof open) => (on: boolean) => setOpen(o => ({ ...o, [id]: on }));
  const settled = useSettled(text, 400);
  const clearance = useMemo(() => readClearance(settled), [settled]);
  const heardIt = heardAny(clearance);
  const asked = useMemo(() => placesAsked(clearance), [clearance]);
  const wantsPlaces = !!(asked.limit || asked.route.length || asked.departure || asked.arrival);
  const found = useQuery({
    queryKey: ["clearance-places", asked, near, route.dep, route.dest],
    queryFn: () => api.clearancePlaces({ ...asked, near, dep: route.dep || null, dest: route.dest || null }),
    enabled: wantsPlaces, staleTime: 10 * 60_000,
  });
  const places = found.data as Found | undefined;
  const ready = heardIt && settled === text && (!wantsPlaces || !!places);
  const cleared = useMemo(() => (ready ? clearedRoute(settled, places ?? {}, route) : null), [ready, settled, places, route]);
  const altitudeFt = clearance.vfr ? null : clearance.expectFt ?? clearance.maintainFt;
  const heardAt = heard.find(t => t.final && t.text === settled)?.at;

  // Listening to the radio goes on with the card put away: the captions
  // over the map carry it (RadioLayer), and Stop here ends it.
  const onRadio = listening && mode === "radio";
  const toggle = () => {
    if (onRadio) stopRadio();
    else {
      setFollowing(true);
      void startRadio([], (tail && callPattern(tail)) || undefined);
    }
  };

  // The pilot's read back, heard or typed, checked against the clearance.
  // Read back again listens for it: with the radio listened to on and on,
  // the next transmission settled is it; otherwise the microphone opens
  // for this one read back (listenOnce, the pill over the map typing it),
  // and the card takes the words as it ends. The wait is a subscription
  // to the radio's store, started by the tap and ended at every end the
  // listening has, or with the card.
  const [readback, setReadback] = useState("");
  const [readingBack, setReadingBack] = useState(false);
  const [readbackProblem, setReadbackProblem] = useState<string | null>(null);
  const waiting = useRef<(() => void) | null>(null);
  useEffect(() => {
    const wait = waiting;
    return () => { wait.current?.(); wait.current = null; };
  }, []);
  const readBackAgain = () => {
    waiting.current?.();
    setFollowing(false);
    setReadback("");
    setReadbackProblem(null);
    setReadingBack(true);
    const clearedText = text;
    const radio = useAtcRadio.getState();
    const after = radio.heard.at(-1)?.id ?? -1;
    const fromRadio = radio.listening && radio.mode === "radio";
    const done = (said: string, problem: string | null) => {
      waiting.current?.();
      waiting.current = null;
      setReadback(said);
      setReadbackProblem(problem);
      setReadingBack(false);
    };
    waiting.current = useAtcRadio.subscribe(s => {
      if (fromRadio) {
        const next = s.heard.find(t => t.final && t.id > after);
        if (next) done(next.text, null);
        else if (!s.listening) done("", s.error);
      } else if (s.pill?.readbackOf === clearedText) {
        if (!s.pill.listening) {
          done(s.pill.text, s.pill.text ? null : s.pill.error);
          useAtcRadio.setState({ pill: null });
        }
      } else if (!s.listening) {
        done("", null);
      }
    });
    if (!fromRadio) void listenOnce([], clearedText);
  };
  const readbackTap = () => {
    if (!readingBack) { readBackAgain(); return; }
    // A second tap ends it: the microphone's listening, or the wait for
    // the radio's next transmission.
    if (useAtcRadio.getState().mode === "once") stopRadio();
    else { waiting.current?.(); waiting.current = null; setReadingBack(false); }
  };
  const check = useMemo(() => (heardIt && readback.trim() ? readbackCheck(settled, readback) : null), [heardIt, settled, readback]);
  const parts = clearanceParts(clearance);
  const readCount = check ? Math.max(0, parts.length - check.items.length) : 0;
  const lines = check ? readbackLines(clearance, check) : [];

  // Enter Route, the one tap that changes the plan; the row says so after.
  const [enteredText, setEnteredText] = useState<string | null>(null);
  const isEntered = enteredText !== null && enteredText === settled;
  const enterRoute = () => {
    if (!cleared || !enter) return;
    enter(cleared.route, cleared.typed, altitudeFt);
    setEnteredText(settled);
    onDone();
  };
  const difference = cleared ? routeDifference(route, cleared.route, cleared.typed) : null;

  const log = [...heard].reverse().filter(t => t.final).slice(0, 10);
  const limit = clearance.classB ? "Class Bravo airspace" : places?.limit?.ident ? <Place place={places.limit} /> : clearance.limit && capital(clearance.limit);
  const altitude = altitudeLine(clearance);
  // The input's own problems are said under its picker (ListenThrough).
  const problem = error ?? readbackProblem ?? (found.isError ? "The places in it could not be looked up; check the connection and try again." : null);
  const mic = canListen();

  const hearState = onRadio ? "Listening…" : heardIt ? (heardAt ? `Heard ${time(heardAt)}` : "Heard") : NOT_YET;
  const readbackState = readingBack ? "Listening…"
    : !check ? NOT_YET
      : check.items.length === 0 ? "Read back in full"
        : <span className="text-caution-ink">{readCount} of {parts.length} read back</span>;
  const enterState = isEntered ? "Route entered"
    : !heardIt ? NOT_YET
      : settled !== text ? <span className="text-muted-foreground">Reading…</span>
        : found.isError ? <span className="text-caution-ink">Places not found</span>
          : !cleared ? <span className="text-muted-foreground">Finding places…</span>
            : `${cleared.route.dest || route.dest || "the route"}${cleared.route.stops.length ? ` via ${cleared.route.stops.join(" ")}` : ""}${altitudeFt ? `, fly ${altitudeWords(altitudeFt)}` : ""}`;
  const compareState = !difference ? NOT_YET
    : difference.same ? "Same as filed"
      : <span className="text-caution-ink">{difference.parts.length} difference{difference.parts.length > 1 ? "s" : ""}</span>;

  return (
    <div className="flex flex-col gap-3" data-testid="clearance-body">
      <ListGroup>
        <Step
          id="hear" title="Hear" state={hearState} open={open.hear} onOpenChange={openRow("hear")}
          control={mic && (
            <IconButton
              label={onRadio ? "Stop" : "Listen"} aria-pressed={onRadio} disabled={listening && !onRadio}
              onClick={toggle} data-testid="clearance-toggle" className={ROW_MIC}
            >
              {onRadio ? <Square className="size-5" strokeWidth={1.5} aria-hidden="true" /> : <Mic className="size-5" strokeWidth={1.5} aria-hidden="true" />}
            </IconButton>
          )}
        >
          {mic && <ListenThrough />}
          <Textarea
            value={text} onChange={e => pick(e.target.value)} rows={3}
            placeholder={`${!mic ? "Type it as read: " : heardThrough(input) ? "Tap the microphone, or type it as read: " : "Tap the microphone and hold the phone to the speaker, or type it as read: "}${EXAMPLE}`}
            aria-label="The clearance as heard" data-testid="clearance-text"
            className={cn(TEXT.detail, "resize-none font-mono")}
          />
          {heardIt && (
            <div className="flex flex-col gap-1">
              {limit && <Line name="Cleared to">{limit}</Line>}
              {(clearance.route.length > 0 || clearance.asFiled) && (
                <Line name="Route"><RouteWords items={clearance.route} asFiled={clearance.asFiled} found={places} /></Line>
              )}
              {altitude && <Line name="Altitude">{altitude}</Line>}
              {clearance.frequency && <Line name="Frequency">{`${clearance.facility ? capital(clearance.facility) : ""} ${clearance.frequency}`.trim()}</Line>}
              {clearance.squawk && <Line name="Transponder">{clearance.squawk}</Line>}
            </div>
          )}
          {/* The radio as heard, newest first, a call to us in bold: a tap
              reads that one above. */}
          {log.length > 0 && (
            <ul className="flex flex-col" aria-label="The radio as heard">
              {log.map(t => (
                <li key={t.id}>
                  <button
                    type="button" onClick={() => pick(t.text)} data-testid="radio-log-row"
                    className={cn("relative w-full py-1 text-left text-tint outline-none after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", t.forUs && "font-semibold")}
                  >
                    <span className="text-muted-foreground tabular-nums">{time(t.at)}</span> {t.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Step>
        <Step
          id="readback" title="Read back" state={readbackState} open={open.readback} onOpenChange={openRow("readback")}
          control={mic && (
            <IconButton
              label={readingBack ? "Stop" : "Read back again"} aria-pressed={readingBack} disabled={!heardIt || (listening && !readingBack)}
              onClick={readbackTap} data-testid="clearance-readback-mic" className={ROW_MIC}
            >
              {readingBack ? <Square className="size-5" strokeWidth={1.5} aria-hidden="true" /> : <Mic className="size-5" strokeWidth={1.5} aria-hidden="true" />}
            </IconButton>
          )}
        >
          {lines.length > 0 && (
            <div className="flex flex-col gap-1" role="status" data-testid="clearance-readback-lines">
              {lines.map(line => <Verdict key={line.words} ok={line.ok} said={["Read back", "Differs"]}>{line.words}</Verdict>)}
            </div>
          )}
          <Textarea
            value={readback} onChange={e => { setReadback(e.target.value); setReadbackProblem(null); }} rows={2}
            placeholder={`${mic ? "Tap the microphone, or type your read back as said: " : "Your read back as said: "}${EXAMPLE_READBACK}`}
            aria-label="Your read back, as said" data-testid="clearance-readback-text"
            className={cn(TEXT.detail, "resize-none font-mono")}
          />
        </Step>
        <Step
          id="enter" title="Enter" state={enterState} open={open.enter} onOpenChange={openRow("enter")}
          control={(
            <Button
              size="sm" disabled={!cleared || !enter || isEntered} aria-busy={found.isFetching || undefined}
              onClick={enterRoute} data-testid="clearance-enter" className={ROW_BUTTON}
            >
              Enter Route
            </Button>
          )}
        >
          {cleared ? (
            <>
              <Line name="Route">{routeLine(cleared.route)}</Line>
              {cleared.typed.length > 0 && <Line name="Procedures">{cleared.typed.map(t => t.name).join(", ")}</Line>}
              <Line name="Altitude">
                {altitudeFt ? `Fly ${altitudeWords(altitudeFt)}${clearance.expectFt !== null ? ", expected" : ""}` : clearance.vfr ? "VFR, as planned" : "As planned"}
              </Line>
            </>
          ) : <p className="text-muted-foreground">Nothing to enter yet.</p>}
        </Step>
        <Step id="compare" title="Compare" state={compareState} open={open.compare} onOpenChange={openRow("compare")}>
          {cleared && difference ? (
            <>
              <Line name="Filed">{routeLine(route)}</Line>
              <Line name="Cleared">{routeLine(cleared.route)}</Line>
              <Verdict ok={difference.same} said={["As filed", "Differs"]}>{difference.same ? difference.words : `Differs from what you filed: ${difference.words}`}</Verdict>
            </>
          ) : <p className="text-muted-foreground">Nothing to compare yet.</p>}
        </Step>
      </ListGroup>
      {problem && <FieldError data-testid="clearance-error">{problem}</FieldError>}
    </div>
  );
}
