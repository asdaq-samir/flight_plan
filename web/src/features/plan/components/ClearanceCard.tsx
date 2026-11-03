import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, Route as RouteGlyph, Square } from "lucide-react";
import { cn } from "cn";
import { CardAction } from "../../../components/CardAction";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { FieldError } from "../../../components/ui/field";
import { Textarea } from "../../../components/ui/textarea";
import { api } from "../../../lib/api/client";
import { clearedRoute, heardAny, placesAsked, readClearance, type ClearedItem, type Found, type FoundPlace } from "../../../lib/clearance";
import { canListen } from "../../../lib/listen";
import { useAtcRadio, useRadioActions } from "../../../lib/atcRadio";
import { startRadio, stopRadio } from "../../../lib/atcListening";
import { callPattern } from "../../../lib/heardCall";
import { altitudeWords } from "../../../lib/readback";
import { inNativeApp } from "../../../lib/native";
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
export default function ClearanceCard({ onDone }: {
  /** The card put away, the route entered. */
  onDone: () => void;
}) {
  const { listening, error, heard, tail, near } = useAtcRadio();
  const route = useRadioActions(s => s.route);
  const enter = useRadioActions(s => s.enter);
  const typed = useAtcRadio(s => s.cardText) ?? "";
  // While listening the card reads the newest transmission settled, until
  // the pilot picks one from the log or types.
  const [following, setFollowing] = useState(true);
  const newest = [...heard].reverse().find(t => t.final);
  const text = listening && following && newest ? newest.text : typed;
  const pick = (picked: string) => {
    setFollowing(false);
    useAtcRadio.setState({ cardText: picked });
  };
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
    enabled: wantsPlaces, staleTime: 10 * 60_000,
  });
  const places = found.data as Found | undefined;
  const ready = heardAny(clearance) && settled === text && (!wantsPlaces || !!places);
  const entered = ready ? clearedRoute(settled, places ?? {}, route) : null;
  const altitudeFt = clearance.vfr ? null : clearance.expectFt ?? clearance.maintainFt;
  // Listening goes on with the card put away: the captions over the map
  // carry it (RadioLayer), and Stop here ends it.
  const toggle = () => {
    if (listening) stopRadio();
    else {
      setFollowing(true);
      void startRadio(words.data ?? [], (tail && callPattern(tail)) || undefined);
    }
  };
  const log = [...heard].reverse().filter(t => t.final).slice(0, 10);

  const limit = clearance.classB ? "Class Bravo airspace" : places?.limit?.ident ? <Place place={places.limit} /> : clearance.limit && capital(clearance.limit);
  return (
    <div className="flex flex-col gap-3" data-testid="clearance-body">
      <Textarea
        value={text} onChange={e => pick(e.target.value)} rows={3}
        placeholder={canListen() ? "Tap Listen and hold the phone to the speaker, or type the clearance." : "Type the clearance as it was read."}
        aria-label="The clearance as heard" data-testid="clearance-text"
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
            icon={listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />} label={listening ? "Stop" : "Keep Listening"}
            pressed={listening} onClick={toggle} testId="clearance-toggle"
          />
        )}
        <CardAction
          icon={<RouteGlyph aria-hidden="true" />} label="Enter Route" filled disabled={!entered || !enter} busy={found.isFetching}
          onClick={() => { if (entered && enter) { enter(entered.route, entered.typed, altitudeFt); onDone(); } }} testId="clearance-enter"
        />
      </div>
      {/* The radio as heard, newest first, a call to us in the tint: a
          tap reads that one above. */}
      {log.length > 0 && (
        <ListGroup title="Heard">
          {log.map(t => (
            <ListRow
              key={t.id} onClick={() => pick(t.text)} data-testid="radio-log-row"
              title={<span className={cn(t.forUs && "font-semibold text-tint")}>{t.text}</span>}
              description={new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
