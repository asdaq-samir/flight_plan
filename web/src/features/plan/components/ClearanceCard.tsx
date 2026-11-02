import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { Mic, Route as RouteGlyph, Square } from "lucide-react";
import { cn } from "cn";
import { CardAction } from "../../../components/CardAction";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { FieldError } from "../../../components/ui/field";
import { Textarea } from "../../../components/ui/textarea";
import { api } from "../../../lib/api/client";
import { clearedRoute, heardAny, placesAsked, readClearance, type ClearedItem, type Found, type FoundPlace } from "../../../lib/clearance";
import { canListen, listen } from "../../../lib/listen";
import { inNativeApp } from "../../../lib/native";
import type { TypedProcedure } from "../../../lib/procedures";
import { SearchNear } from "../../../lib/useAirportSearch";
import { TEXT } from "../../../lib/text";
import type { RouteParts } from "./RouteBox";

/** What was last heard or typed, kept while the page is: the card opened
 *  again shows the clearance still, its squawk and frequency with it. */
const useHeard = create<{ text: string }>(() => ({ text: "" }));

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

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. */
function altitudeWords(ft: number): string {
  return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString("en-US")} ft`;
}

const capital = (words: string) => words.replace(/\b[a-z]/g, ch => ch.toUpperCase());

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

/**
 * A clearance heard, or typed, and what the planner found in it: the
 * pilot reads it here, its places as found -- one found by its sound
 * only marked, one not found said so -- and Enter Route puts it in the
 * route, the expected altitude (else the one to maintain) flown. Nothing
 * heard changes the plan before that.
 */
export default function ClearanceCard({ route, onEnter }: {
  route: RouteParts;
  onEnter: (route: RouteParts, typed: TypedProcedure[], altitudeFt: number | null) => void;
}) {
  const near = useContext(SearchNear);
  const text = useHeard(s => s.text);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const stopping = useRef<(() => void) | null>(null);
  // Put away, the card stops listening.
  useEffect(() => () => stopping.current?.(), []);
  // The names to listen for, asked as the card opens, ready by the tap:
  // the apps' recognizers take them, a browser's cannot.
  const words = useQuery({
    queryKey: ["clearance-words", near, route.dep], queryFn: () => api.clearanceWords(near, route.dep),
    enabled: inNativeApp(), staleTime: 60 * 60_000,
  });
  const settled = useSettled(text, 400);
  const clearance = useMemo(() => readClearance(settled), [settled]);
  const asked = useMemo(() => placesAsked(clearance), [clearance]);
  const wantsPlaces = !!(asked.limit || asked.route.length || asked.departure || asked.arrival);
  const found = useQuery({
    queryKey: ["clearance-places", asked, near, route.dep, route.dest],
    queryFn: () => api.clearancePlaces({ ...asked, near, dep: route.dep || null, dest: route.dest || null }),
    enabled: wantsPlaces && !listening, staleTime: 10 * 60_000,
  });
  const places = found.data as Found | undefined;
  const ready = heardAny(clearance) && !listening && settled === text && (!wantsPlaces || !!places);
  const entered = ready ? clearedRoute(clearance, places ?? {}, route) : null;
  const altitudeFt = clearance.vfr ? null : clearance.expectFt ?? clearance.maintainFt;

  const toggle = async () => {
    if (listening) {
      stopping.current?.();
      return;
    }
    setError(undefined);
    setListening(true);
    useHeard.setState({ text: "" });
    const { stop } = await listen(words.data ?? [], heard => useHeard.setState({ text: heard }), failed => {
      setListening(false);
      stopping.current = null;
      if (failed) setError(failed);
    });
    stopping.current = stop;
  };

  const limit = clearance.classB ? "Class Bravo airspace" : places?.limit?.ident ? <Place place={places.limit} /> : clearance.limit && capital(clearance.limit);
  return (
    <div className="flex flex-col gap-3" data-testid="clearance-body">
      <Textarea
        value={text} onChange={e => useHeard.setState({ text: e.target.value })} rows={3}
        placeholder={canListen() ? "Tap Listen and hold the phone to the speaker, or type the clearance." : "Type the clearance as it was read."}
        aria-label="The clearance as heard" readOnly={listening} data-testid="clearance-text"
        className={cn(TEXT.row, "resize-none")}
      />
      {error && <FieldError data-testid="clearance-error">{error}</FieldError>}
      {heardAny(clearance) && (
        <ListGroup>
          {limit && <ListRow title="Cleared To" value={limit} />}
          {clearance.route.length > 0 || clearance.asFiled ? (
            <ListRow title="Route" description={<RouteWords items={clearance.route} asFiled={clearance.asFiled} found={places} />} />
          ) : null}
          {clearance.maintainFt !== null && (
            <ListRow
              title="Maintain"
              value={`${clearance.vfr ? "VFR " : ""}${clearance.maintainLimit ? `${clearance.maintainLimit} ` : ""}${altitudeWords(clearance.maintainFt)}`}
            />
          )}
          {clearance.expectFt !== null && (
            <ListRow title="Expect" value={`${altitudeWords(clearance.expectFt)}${clearance.expectMin ? `, ${clearance.expectMin} min after departure` : ""}`} />
          )}
          {clearance.frequency && <ListRow title={clearance.facility ? capital(clearance.facility) : "Frequency"} value={clearance.frequency} />}
          {clearance.squawk && <ListRow title="Squawk" value={clearance.squawk} />}
        </ListGroup>
      )}
      {found.isError && <FieldError>The places in it could not be looked up; check the connection and try again.</FieldError>}
      <div className={cn("grid gap-2", canListen() ? "grid-cols-2" : "grid-cols-1")}>
        {canListen() && (
          <CardAction
            icon={listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />} label={listening ? "Stop" : "Listen"}
            pressed={listening} onClick={() => void toggle()} testId="clearance-toggle"
          />
        )}
        <CardAction
          icon={<RouteGlyph aria-hidden="true" />} label="Enter Route" filled disabled={!entered} busy={found.isFetching}
          onClick={() => entered && onEnter(entered.route, entered.typed, altitudeFt)} testId="clearance-enter"
        />
      </div>
    </div>
  );
}
