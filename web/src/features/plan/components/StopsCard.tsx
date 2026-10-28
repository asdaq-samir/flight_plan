import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { cn } from "cn";
import { CardClose } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import QueryState from "../../../components/QueryState";
import { ADD_CAPSULE } from "../../../components/mapChrome";
import PullDown from "../../../components/PullDown";
import StopKindGlyph from "../../../components/StopKindGlyph";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { placeWords } from "../../../lib/advisories";
import type { StopField } from "../../../lib/api/types";
import { usePreferences } from "../../../lib/preferences";
import { stopsAlongQuery, stopsNearQuery } from "../../../lib/queryClient";
import { kindLines, kindsOf, PICK_ORDER, STOP_KINDS, STOP_RADII, telOf, whereWords, type StopPick } from "../../../lib/stopKinds";
import { TEXT } from "../../../lib/text";

/** A kind's pill as iOS sets a filter: its round glyph and its name,
 *  filled in the tint when picked; 32 points with a 44-point area round
 *  it as a pseudo-element, eight apart so the areas meet. An item of the
 *  stock ToggleGroup, so its own grey for the picked one and a hover are
 *  set back to the pill's: the fill stays the tint under a mouse, as the
 *  route's chips do (GLASS_PICKED), and the focus ring sits on its edge. */
const PILL = cn(
  "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap outline-none",
  "after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0", TEXT.detail,
  "bg-foreground/8 text-foreground hover:bg-foreground/8 hover:text-foreground",
  "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground hover:data-[state=on]:bg-primary hover:data-[state=on]:text-primary-foreground",
);

/** What none of the fields has, for the empty list's line. */
const NONE_OF: Record<StopPick, string> = {
  all: "fuel, food, repair or flight training",
  fuel: "fuel",
  food: "a restaurant on the field",
  repair: "a repair shop",
  training: "a flight school",
};

/** The round Call: the airport's own number (NASR's APT_CON, the
 *  manager's else the owner's), a tel: link; none where the FAA lists none. */
const CALL = "relative grid size-8 shrink-0 place-items-center rounded-full bg-tint/12 text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A field's row, the owner's layout (2026-10-27): its ident (a tap its
 * card) and town; how far and which way, or how far off the route; then
 * a line for each kind it has -- the kind's round glyph, "Fuel:" and
 * the names -- and at the right Call and the main button, Direct To round
 * the pilot, Add Stop along the route (as Fly-in Food's were).
 */
function StopRow({ field, along, onOpenField, onAddStop, onDirect }: {
  field: StopField; along: boolean;
  onOpenField: (ident: string) => void; onAddStop: (field: StopField) => void; onDirect: (ident: string) => void;
}) {
  const tel = telOf(field.phone);
  return (
    <ListRow
      data-testid="stops-field"
      title={(
        <button
          type="button" onClick={() => onOpenField(field.ident)} data-testid="stops-field-open"
          className="relative text-left outline-none after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-bold text-tint">{field.ident}</span>
          {field.city && <span className="text-muted-foreground"> {placeWords(field.city)}</span>}
        </button>
      )}
      description={(
        <span className="flex flex-col gap-1">
          <span className="tabular-nums">{whereWords(field, along)}</span>
          {kindLines(field).map(({ kind, words }) => (
            <span key={kind} className="flex items-start gap-2 text-foreground" data-testid={`stops-line-${kind}`}>
              {/* On the first line's middle, however many lines the names take. */}
              <StopKindGlyph kind={kind} className="mt-px" />
              <span className="min-w-0"><span className="font-semibold">{STOP_KINDS[kind].name}:</span> {words}</span>
            </span>
          ))}
        </span>
      )}
    >
      <span className="flex items-center gap-2 self-start">
        {tel && (
          <a href={tel} className={CALL} aria-label={`Call ${field.ident}`} data-testid="stops-call">
            <Phone className="size-4" aria-hidden="true" />
          </a>
        )}
        {along ? (
          <button type="button" onClick={() => onAddStop(field)} data-testid="stops-add-stop" aria-label={`Add ${field.ident} as a stop`} className={cn(ADD_CAPSULE, "whitespace-nowrap")}>
            Add Stop
          </button>
        ) : (
          <button type="button" onClick={() => onDirect(field.ident)} data-testid="stops-direct" aria-label={`Direct to ${field.ident}`} className={cn(ADD_CAPSULE, "whitespace-nowrap")}>
            Direct To
          </button>
        )}
      </span>
    </ListRow>
  );
}

/**
 * The map's Stops, one sheet near the pilot and along a route (the
 * owner's pick of the Stops canvas, H1 and H2, 2026-10-27), where Fly-in
 * Food was: its title, beside it how far to look -- Along Route, where
 * there is a route, or Within 10, 25, 50 or 100 nm round the pilot --
 * then the kinds as pills, All, Food, Fuel, Repair and Training, the one
 * picked kept (preferences), and a row for each field with what it has
 * (the planner's /api/stops/near and /api/stops/along).
 */
export default function StopsCard({ at, route, scope, onScope, onClose, onOpenField, onAddStop, onDirect }: {
  /** Own ship, for Within; null where it is not known. */
  at: { lat: number; lon: number } | null;
  /** The course drawn, for Along Route: its ends and stops. */
  route: { dep: string; dest: string; stops: string } | null;
  scope: "route" | "near";
  onScope: (scope: "route" | "near") => void;
  onClose: () => void;
  onOpenField: (ident: string) => void;
  /** Along a route: the field put in it as a stop, where it falls. */
  onAddStop: (field: StopField) => void;
  /** Round the pilot: a flight from here straight to the field. */
  onDirect: (ident: string) => void;
}) {
  const radius = usePreferences(p => p.stopsRadiusNm);
  const setRadius = usePreferences(p => p.setStopsRadiusNm);
  const pick = usePreferences(p => p.stopKind);
  const setPick = usePreferences(p => p.setStopKind);
  const along = scope === "route" && !!route;
  const near = useQuery({ ...stopsNearQuery(at?.lat ?? 0, at?.lon ?? 0, radius), enabled: !along && !!at });
  const onRoute = useQuery({ ...stopsAlongQuery(route?.dep ?? "", route?.dest ?? "", route?.stops ?? ""), enabled: along });
  const asked = along ? onRoute : near;
  const { data } = asked;
  const pending = data?.pending ?? 0;
  const fields = (data?.fields ?? []).filter(f => pick === "all" || kindsOf(f).includes(pick));
  const placesShown = fields.some(f => f.food?.length || f.training?.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="stops-card">
      {/* The close for the card's own keys and readers (CardClose); the
          bar over the card shows its title, "Stops", and its own close. */}
      <CardClose onClose={onClose} testId="stops-close" />
      <div className="flex items-center gap-3">
        {/* Wider than a phone there is no bar over the card: the title here. */}
        <h2 className={cn("sr-only font-bold tracking-tight md:not-sr-only", TEXT.card)} data-testid="stops-name">Stops</h2>
        <PullDown
          label="Where to look" value={along ? "route" : `${radius}`} align="start" testId="stops-distance"
          onChange={value => {
            if (value === "route") {
              onScope("route");
              return;
            }
            setRadius(Number(value));
            onScope("near");
          }}
          options={[
            ...(route ? [{ value: "route", label: "Along Route", testId: "stops-distance-option" }] : []),
            ...STOP_RADII.map(nm => ({ value: `${nm}`, label: `Within ${nm} nm`, testId: "stops-distance-option" })),
          ]}
        />
      </div>
      {/* Sideways past the card's edge, as Maps' filter pills scroll. One
          kind at a time, so the stock ToggleGroup: to VoiceOver a radio
          group, the arrow keys moving between the kinds, and a tap on the
          one picked keeping it. As wide as the card, not its pills
          (w-auto), or it would not scroll. */}
      <ToggleGroup
        type="single" value={pick} onValueChange={v => { if (v) setPick(v as StopPick); }} aria-label="Kind of stop"
        className="-mx-4 mt-3 w-auto items-stretch overflow-x-auto rounded-none px-4 py-1.5 [scrollbar-width:none]"
      >
        {PICK_ORDER.map(kind => (
          <ToggleGroupItem
            key={kind} value={kind} data-testid={`stops-kind-${kind}`}
            className={cn(PILL, kind === "all" ? "px-3.5" : "px-0 pr-3.5 pl-1")}
          >
            {kind !== "all" && <StopKindGlyph kind={kind} className="size-6" />}
            {kind === "all" ? "All" : STOP_KINDS[kind].name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pb-3">
        {!along && !at && (
          <ListGroup>
            <ListRow muted title={route ? "Turn on your location to look round you" : "Turn on your location, or enter a route, to find stops at the airports"} />
          </ListGroup>
        )}
        {(along || at) && !data && <QueryState query={asked} fetching="Fetching the airports…" failed="The airports could not be fetched." />}
        {data && (
          <ListGroup>
            {fields.map(field => (
              <StopRow key={field.ident} field={field} along={along} onOpenField={onOpenField} onAddStop={onAddStop} onDirect={onDirect} />
            ))}
            {fields.length === 0 && pending === 0 && (
              <ListRow muted title={along ? `No airport along the route has ${NONE_OF[pick]}` : `No airport within ${radius} nm has ${NONE_OF[pick]}`} />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                muted title={<>Looking at {pending} more {pending === 1 ? "airport" : "airports"}…</>}
                data-testid="stops-pending"
              />
            )}
          </ListGroup>
        )}
        {/* Overture's licence asks for its credit where its places show. */}
        {placesShown && <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>}
      </div>
    </div>
  );
}
