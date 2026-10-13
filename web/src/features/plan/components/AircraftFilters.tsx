import { useMemo, useState } from "react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import Segmented from "../../../components/Segmented";
import TogglePill from "../../../components/TogglePill";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import type { TrafficAircraft } from "../../../lib/api/types";
import { type FilterBand, filtering, type FilterKind, type FilterPlace, type FilterRelation, NO_FILTER, operatorOf } from "../../../lib/fbo";
import type { LatLon } from "../../../lib/geo";
import { usePreferences } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";
import AircraftRow from "./AircraftRow";
import { useFilteredAircraft } from "../hooks/useAircraftQuestion";

const PLACES = [
  { value: "map", label: "On the map" },
  { value: "near", label: "Near me" },
  { value: "airport", label: "Airport" },
];
const RELATIONS = [
  { value: "around", label: "About" },
  { value: "inbound", label: "Inbound" },
  { value: "departing", label: "Departing" },
  { value: "based", label: "Based" },
];
const NEAR_NM = [5, 10, 25, 50];
const KINDS: { value: FilterKind; label: string }[] = [
  // By weight, as the transponder's emitter category is (lib/fbo kindOf).
  { value: "any", label: "Any" }, { value: "light", label: "Light, under 15,500 lb" }, { value: "small", label: "Small, to 75,000 lb" },
  { value: "large", label: "Large, over 75,000 lb" }, { value: "helicopter", label: "Helicopter" }, { value: "other", label: "Other" },
];
const BANDS: { value: FilterBand; label: string }[] = [
  { value: "any", label: "Any" }, { value: "low", label: "Below 3,000 ft" }, { value: "mid", label: "3,000–10,000 ft" },
  { value: "high", label: "10,000–18,000 ft" }, { value: "flight-levels", label: "FL180 and up" },
];

/**
 * The Aircraft tab's filters and the airplanes they keep, at the owner's
 * ask, for an FBO's desk as much as a pilot's: where -- the map's view,
 * near the pilot, or round an airport, there inbound, departing, based or
 * about -- and what: kind, height, operator, an emergency (lib/fbo). Kept
 * in this browser. With nothing asked for, no list.
 */
export default function AircraftFilters({ seen, from, ownFt, onPick }: {
  seen: TrafficAircraft[];
  from: LatLon | null;
  ownFt: number | null;
  onPick: (plane: TrafficAircraft) => void;
}) {
  // The filter as asked, and the airplanes it keeps: the pill's strip's
  // own question (useAircraftQuestion), so the two agree.
  const { filter, noField, pool, kept, looking } = useFilteredAircraft(seen, from);
  const change = usePreferences(s => s.setAircraftFilter);
  const [airportTyped, setAirportTyped] = useState(filter.airport);
  const operators = useMemo(() => [...new Set(pool.map(operatorOf).filter((o): o is string => !!o))].sort(), [pool]);
  const on = filtering(filter);
  return (
    <>
      <ListGroup title="Filter" action={on ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => { change(NO_FILTER); setAirportTyped(""); }}
          className={cn("relative h-auto px-1 py-0.5 font-normal text-tint after:absolute after:-inset-x-2 after:-inset-y-3", TEXT.row)}
          data-testid="aircraft-filter-clear">Clear</Button>
      ) : undefined}>
        <ListRow title="Where">
          <Segmented label="Where" value={filter.place} onChange={v => change({ place: v as FilterPlace })} options={PLACES} testId="filter-place" />
        </ListRow>
        {filter.place === "near" && (
          <ListRow title="Within">
            <FilterSelect label="Within" value={String(filter.nearNm)} onChange={v => change({ nearNm: Number(v) })}
              options={NEAR_NM.map(n => ({ value: String(n), label: `${n} nm` }))} testId="filter-near" />
          </ListRow>
        )}
        {filter.place === "airport" && (
          <>
            <ListRow id="filter-airport" title="Airport">
              <input
                id="filter-airport" value={airportTyped} placeholder="KLWM" autoCapitalize="characters" spellCheck={false}
                onChange={e => setAirportTyped(e.target.value.toUpperCase())}
                onBlur={() => change({ airport: airportTyped.trim() })}
                onKeyDown={e => { if (e.key === "Enter") change({ airport: airportTyped.trim() }); }}
                className={cn("w-24 rounded-md bg-muted px-2 py-1 text-right font-mono uppercase text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.row)}
                data-testid="filter-airport"
              />
            </ListRow>
            <ListRow title="Traffic">
              <Segmented label="Traffic at the airport" value={filter.relation} onChange={v => change({ relation: v as FilterRelation })}
                options={RELATIONS} testId="filter-relation" />
            </ListRow>
          </>
        )}
        <ListRow title="Kind">
          <FilterSelect label="Kind" value={filter.kind} onChange={v => change({ kind: v as FilterKind })} options={KINDS} testId="filter-kind" />
        </ListRow>
        <ListRow title="Altitude">
          <FilterSelect label="Altitude" value={filter.band} onChange={v => change({ band: v as FilterBand })} options={BANDS} testId="filter-band" />
        </ListRow>
        <ListRow title="Operator">
          <FilterSelect
            label="Operator" value={filter.operator || "any"} onChange={v => change({ operator: v === "any" ? "" : v })} testId="filter-operator"
            options={[{ value: "any", label: "Any" }, ...[...new Set([...operators, ...(filter.operator ? [filter.operator] : [])])].map(o => ({ value: o, label: o }))]}
          />
        </ListRow>
        <ListRow title="Emergencies only">
          <TogglePill pressed={filter.emergency} onPressedChange={emergency => change({ emergency })} label="7500, 7600, 7700" testId="filter-emergency" />
        </ListRow>
      </ListGroup>
      {on && (
        <ListGroup
          title={`Airplanes · ${kept.length}`}
          footer={[
            filter.place === "airport" && filter.relation !== "based"
              ? "Inbound and departing are read from each airplane's track and climb, not its flight plan, which the FAA does not publish openly."
              : null,
            filter.place === "airport" && filter.relation === "based"
              ? "Based is where each airplane's flights of the last weeks begin and end most, from adsb.lol's archive."
              : null,
            "From adsb.lol's ADS-B receivers, under the Open Database License: seconds old, for knowing what is about, not for avoiding it.",
          ].filter(Boolean).join(" ")}
        >
          {filter.place === "airport" && noField && <ListRow title={<span className="text-destructive">No such airport</span>} />}
          {filter.place === "near" && !from && <ListRow title={<span className="text-muted-foreground">Your position is needed for this</span>} />}
          {kept.map(plane => <AircraftRow key={plane.hex} plane={plane} from={from} ownFt={ownFt} onPick={() => onPick(plane)} testId="filter-row" />)}
          {!kept.length && (
            <ListRow title={<span className="text-muted-foreground" role="status">{looking ? "Looking up where each is based…" : "None heard now"}</span>} />
          )}
          {!!kept.length && looking && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)} role="status">Still looking up others…</span>} />}
        </ListGroup>
      )}
    </>
  );
}

/** A filter's pick of several: the stock Select, as a row's control. */
function FilterSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; testId: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} data-testid={testId} className={cn("min-w-28 justify-between", TEXT.detail)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
