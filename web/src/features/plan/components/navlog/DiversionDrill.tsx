import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Timer, X } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import {
  ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger,
} from "../../../../components/ResponsivePopover";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { api } from "../../../../lib/api/client";
import type { Leg } from "../../../../lib/api/types";
import { ALLOWANCES, divert, reasonable, stopwatch, type Diversion, type EstimateKey } from "../../../../lib/diversion";
import { heading } from "../../../../lib/workings";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../format";
import { grouped } from "../../../../lib/units";

/** A figure as the student would write it. */
function written(key: EstimateKey, value: number): string {
  if (key === "mh") return heading(value);
  if (key === "fuel") return `${value.toFixed(1)} gal`;
  return `${Math.round(value)} ${key === "gs" ? "kt" : "min"}`;
}

/** The diversion worked out, step by step, once checked. */
function Answer({ ident, d }: { ident: string; d: Diversion }) {
  const steps: [string, string][] = [
    ["True course", `${heading(d.tc)}, ${d.distanceNm.toFixed(1)} nm`],
    ["Wind correction", `${d.wca >= 0 ? "+" : "−"}${Math.abs(d.wca).toFixed(0)}°`],
    ["True heading", heading(d.th)],
    ["Magnetic heading", heading(d.mh)],
    ["Ground speed", `${Math.round(d.gs)} kt`],
    ["Time", `${Math.round(d.ete)} min`],
    ["Fuel", `${d.fuel.toFixed(1)} gal`],
  ];
  return (
    <ListGroup title={`To ${ident}, worked out`}>
      {steps.map(([name, value]) => <ListRow key={name} title={name} value={value} />)}
    </ListGroup>
  );
}

/**
 * The diversion drill (ACS PA.VI.C): over a point on the route, the
 * examiner says divert. The clock starts, the student picks a field
 * (the nearest ten, with their runways and weather, and not how far or
 * which way: that is off the chart), estimates the heading, ground speed,
 * time and fuel, and checks them against the exact solution in the
 * leg's own air (lib/diversion). The drill keeps its clock and answers
 * while its sheet is closed, for a look at the chart.
 */
export default function DiversionDrill({ leg, at }: { leg: Leg; at: { name: string; lat: number; lon: number } }) {
  const id = useId();
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [stopped, setStopped] = useState<number | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [typed, setTyped] = useState<Partial<Record<EstimateKey, string>>>({});
  const nearest = useQuery({
    queryKey: ["nearest-airports", at.lat, at.lon],
    queryFn: () => api.nearestAirports(at.lat, at.lon),
    enabled: started != null,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (started == null || stopped != null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [started, stopped]);

  // A field under the point is where the airplane is, not a diversion.
  const fields = (nearest.data ?? []).filter(f => f.distance_nm >= 2).slice(0, 6);
  const chosen = fields.find(f => f.ident === field) ?? null;
  const exact = chosen ? divert(leg, chosen.bearing_deg, chosen.distance_nm) : null;
  const checked = stopped != null;
  const number = (key: EstimateKey) => {
    const value = typed[key];
    return value === undefined || value.trim() === "" ? null : Number(value);
  };
  const start = () => {
    const t = Date.now();
    setStarted(t); setNow(t); setStopped(null); setField(null); setTyped({});
  };

  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button" variant="link" size="sm" className={cn("h-auto p-0 text-tint", TEXT.detail)}
          onClick={e => e.stopPropagation()} data-testid="diversion-drill"
        >
          Divert from here
        </Button>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title={`Diversion over ${at.name}`} className="w-[26rem] max-w-[calc(100vw-2rem)] p-3"
        align="start" data-testid="diversion-content"
      >
        <div className="space-y-3">
          {started == null ? (
            <>
              <p className={TEXT.prose}>
                Over {at.name} at {altFt(leg.altitude_ft)} ft, the examiner says: divert. Pick a field, and work out the
                magnetic heading, ground speed, time and fuel to it from the chart and the leg’s wind.
              </p>
              <Button type="button" className="w-full" onClick={start} data-testid="diversion-start">
                <Timer aria-hidden /> Start the clock
              </Button>
            </>
          ) : (
            <form
              className="space-y-3" aria-label="Your diversion"
              onSubmit={e => { e.preventDefault(); setStopped(Date.now()); }}
            >
              <p className={cn("flex items-center justify-between font-medium tabular-nums", TEXT.prose)} data-testid="diversion-clock">
                <span>{checked ? "You took" : "On the clock"}</span>
                <span>{stopwatch((stopped ?? now) - started)}</span>
              </p>
              <ListGroup title="Divert to" footer="The nearest fields, with their longest runway and their weather: how far and which way are on the chart.">
                {nearest.isPending ? (
                  <ListRow title={<span className="text-muted-foreground">Finding the nearest fields…</span>} />
                ) : fields.length === 0 ? (
                  <ListRow title={<span className="text-muted-foreground">No fields near here</span>} />
                ) : fields.map(f => (
                  <ListRow
                    key={f.ident} role="radio" aria-checked={field === f.ident} disabled={checked}
                    onClick={() => setField(f.ident)}
                    media={<Check className={cn("size-4 text-tint", field !== f.ident && "invisible")} aria-hidden />}
                    title={`${f.ident} · ${f.name}`}
                    description={[
                      f.longest_runway_ft ? `${grouped(f.longest_runway_ft)} ft runway` : "no runway length",
                      f.flight_category ?? "no weather report",
                    ].join(" · ")}
                    data-testid="diversion-field"
                  />
                ))}
              </ListGroup>
              <ListGroup
                title="Your estimates"
                footer="The ACS asks for a reasonable estimate (PA.VI.C.S2) and gives no figures: within 10° and 10 kt, 3 minutes and a gallon is this drill's own."
              >
                {ALLOWANCES.map(a => {
                  const value = number(a.key);
                  const marked = checked && !!exact && value !== null && Number.isFinite(value);
                  const right = marked && reasonable(a.key, value, exact![a.key]);
                  return (
                    <ListRow
                      key={a.key} id={`${id}-${a.key}`} title={a.label}
                      description={marked && !right ? `Not quite: ${written(a.key, exact![a.key])}` : undefined}
                      data-testid={`diversion-${a.key}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {marked && (right
                          ? <Check className="size-4 text-green-700 dark:text-green-400" aria-label="Reasonable" />
                          : <X className="size-4 text-red-700 dark:text-red-400" aria-label="Not reasonable" />)}
                        <Input
                          id={`${id}-${a.key}`} inputMode="decimal" className="h-8 w-20 text-right tabular-nums"
                          value={typed[a.key] ?? ""} disabled={checked} data-testid={`diversion-${a.key}-input`}
                          onChange={e => setTyped({ ...typed, [a.key]: e.target.value })}
                        />
                        <span className={cn("w-7 text-muted-foreground", TEXT.detail)}>{a.unit}</span>
                      </span>
                    </ListRow>
                  );
                })}
              </ListGroup>
              {checked && chosen && (exact
                ? <Answer ident={chosen.ident} d={exact} />
                : <p className={cn("text-red-700 dark:text-red-400", TEXT.prose)}>The wind is too strong for a heading to {chosen.ident} to hold.</p>)}
              {checked && chosen && fields[0] && fields[0].ident !== chosen.ident && (
                <p className={cn("text-muted-foreground", TEXT.note)} data-testid="diversion-nearest">
                  The nearest was {fields[0].ident}, {fields[0].distance_nm.toFixed(0)} nm: was {chosen.ident} the better choice?
                </p>
              )}
              <div className="flex justify-end gap-2">
                {checked
                  ? <Button type="button" size="sm" onClick={start} data-testid="diversion-again">Again</Button>
                  : <Button type="submit" size="sm" disabled={!chosen} data-testid="diversion-check">Check</Button>}
              </div>
            </form>
          )}
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
