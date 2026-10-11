import { lazy, useId } from "react";
import { cn } from "cn";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import AccordionSection from "../../../../components/AccordionSection";
import AfterPaint from "../../../../components/AfterPaint";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { Input } from "../../../../components/ui/input";
import type { AircraftProfile, Briefing, Course } from "../../../../lib/api/types";
import { runwayChecks, type RunwayDistance } from "../../../../lib/runwayCheck";
import { FINDING_TONE } from "../../../../lib/status";
import FindingIcon from "../../../../components/FindingIcon";
import { runwayWind } from "../../format";
import { TEXT } from "../../../../lib/text";
import { altFt, grouped } from "../../../../lib/units";
import { useLoad } from "../../hooks/useLoad";

/** The envelope's picture: Recharts, loaded with the section. */
const EnvelopeChart = lazy(() => import("./EnvelopeChart"));

const pounds = (n: number) => `${grouped(n)} lb`;

/** A number typed into a row: the stock field, short, its unit after it. */
function NumberField({ value, onChange, unit, label, testId }: {
  value: number; onChange: (n: number) => void; unit: string; label: string; testId?: string;
}) {
  const id = useId();
  return (
    // A label round the field and its unit, its 44 pt hit area a
    // pseudo-element behind them (isolate keeps it over the row): a tap
    // just above or below the 32 pt field still lands in it, and the
    // field does not grow.
    <label htmlFor={id} className="relative isolate flex items-center gap-1.5 after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']">
      <Input
        id={id} type="number" inputMode="decimal" min={0} step="any" aria-label={label} data-testid={testId}
        className="h-8 w-24 text-right tabular-nums" value={Number.isFinite(value) ? value : ""}
        onChange={e => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      <span className={cn("w-6 text-muted-foreground", TEXT.detail)}>{unit}</span>
    </label>
  );
}

/**
 * Weight and balance, as its POH's loading graph does it: the airplane's
 * empty weight and arm, each station's load and the fuel, and the
 * weight and centre of gravity at takeoff and at landing -- the trip's
 * fuel burned -- against the most it may weigh and its envelope. For an
 * airplane whose profile has its POH's loading (the 172S's).
 */
export function WeightBalanceSection({ aircraft, tripFuelGal }: { aircraft: AircraftProfile | null | undefined; tripFuelGal: number | null }) {
  const { loading, load, result, setLoad } = useLoad(aircraft, tripFuelGal);
  const summary = !result ? "Built in for the Cessna 172S"
    : `${pounds(result.takeoff.weightLb)} at ${result.takeoff.armIn.toFixed(1)} in${result.problems.length ? "" : " · within limits"}`;
  return (
    <AccordionSection
      title="Weight & Balance" summary={summary}
      finding={result && result.problems.length > 0 ? "stop" : undefined}
      aside={result && result.problems.length > 0 ? (
        <span className={cn("inline-flex items-center gap-1 font-semibold", FINDING_TONE.stop, TEXT.note)} data-testid="wb-flag">
          <OctagonAlert className="size-3.5" aria-hidden />
          Out of limits
        </span>
      ) : undefined}
    >
      {!loading || !load || !result ? (
        <p className={cn("text-muted-foreground", TEXT.prose)}>
          The weight and balance is worked out for an airplane whose loading is built in: the Cessna 172S, from its POH.
        </p>
      ) : (
        <div className="space-y-4" data-testid="weight-balance">
          <ListGroup title="The airplane" footer="From its own weight and balance record; the POH's sample airplane until set.">
            <ListRow title="Empty weight">
              <NumberField value={load.emptyWeightLb} unit="lb" label="Empty weight" onChange={n => setLoad({ ...load, emptyWeightLb: n })} testId="wb-empty-weight" />
            </ListRow>
            <ListRow title="Empty arm">
              <NumberField value={load.emptyArmIn} unit="in" label="Empty arm" onChange={n => setLoad({ ...load, emptyArmIn: n })} />
            </ListRow>
          </ListGroup>
          <ListGroup title="Loaded">
            {loading.stations.map((station, i) => (
              <ListRow key={station.name} title={station.name} description={station.max_lb != null ? `${pounds(station.max_lb)} at most` : undefined}>
                <NumberField
                  value={load.stationsLb[i] ?? 0} unit="lb" label={station.name} testId={`wb-station-${i}`}
                  onChange={n => setLoad({ ...load, stationsLb: loading.stations.map((_, k) => (k === i ? n : load.stationsLb[k] ?? 0)) })}
                />
              </ListRow>
            ))}
            <ListRow title="Fuel" description={`${loading.fuel_max_gal} gal usable`}>
              <NumberField value={load.fuelGal} unit="gal" label="Fuel" onChange={n => setLoad({ ...load, fuelGal: n })} testId="wb-fuel" />
            </ListRow>
          </ListGroup>
          <ListGroup title="Balance" footer={`${loading.source}. The start and taxi's ${loading.start_taxi_fuel_lb} lb of fuel off at takeoff; the trip's at landing.`}>
            <ListRow title="Takeoff" value={`${pounds(result.takeoff.weightLb)} · ${result.takeoff.armIn.toFixed(1)} in`} />
            <ListRow title="Landing" value={`${pounds(result.landing.weightLb)} · ${result.landing.armIn.toFixed(1)} in`} />
            {result.problems.length === 0 ? (
              <ListRow media={<FindingIcon finding="ok" />} title="Within the weight and the envelope" data-testid="wb-ok" />
            ) : result.problems.map(problem => (
              <ListRow key={problem} media={<FindingIcon finding="stop" />} title={<span className={FINDING_TONE.stop}>{problem}</span>} />
            ))}
          </ListGroup>
          <AfterPaint fallback={<div className="h-56" />}>
            <EnvelopeChart envelope={loading.envelope as [number, number][]} takeoff={result.takeoff} landing={result.landing} />
          </AfterPaint>
        </div>
      )}
    </AccordionSection>
  );
}

/** A distance against the runway it is flown on: the ground roll solid,
 *  the rest of the way over the 50 ft obstacle paler, on the runway's
 *  length -- red, and to the end, where it does not fit. */
function RunwayBar({ distance, lengthFt }: { distance: RunwayDistance; lengthFt: number }) {
  const share = (ft: number) => `${Math.min(100, (ft / lengthFt) * 100)}%`;
  return (
    <span className="mt-1.5 mb-0.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("relative block h-full rounded-full", distance.over ? "bg-red-600/40 dark:bg-red-400/40" : "bg-primary/35")} style={{ width: share(distance.totalFt) }}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", distance.over ? "bg-red-600 dark:bg-red-400" : "bg-primary")} style={{ width: `${Math.min(100, (distance.groundRollFt / Math.max(distance.totalFt, 1)) * 100)}%` }} />
      </span>
    </span>
  );
}

/**
 * The runway check at each airport the flight takes off from or lands at
 * (lib/runwayCheck): the runway the wind favours, the POH's short-field
 * distances on it at the field's pressure altitude and temperature, the
 * weight from Weight & Balance and the reported wind -- drawn against the
 * runway's length -- then the density altitude the airplane performs at,
 * and the wind across the runway against the most the POH demonstrates.
 * First on the Performance tab: whether the runways will do is what is
 * read there first, and the loading under it is what changes the answer.
 */
export function TakeoffLandingSection({ aircraft, briefing, course, landing: landingWeight, takeoff: takeoffWeight }: {
  aircraft: AircraftProfile | null | undefined;
  briefing: Briefing | null;
  course: Course | null;
  takeoff: number | null;
  landing: number | null;
}) {
  const takeoffTable = aircraft?.takeoff ?? null;
  const landingTable = aircraft?.landing ?? null;
  const checks = runwayChecks(aircraft, briefing, course, takeoffWeight, landingWeight);
  const short = [...new Set(checks.filter(c => c.distances.some(d => d.over)).map(c => c.field.ident))];
  const gusty = [...new Set(checks.filter(c => c.crosswindOver).map(c => c.field.ident))];
  const demonstrated = aircraft?.crosswind ?? null;
  const summary = !takeoffTable ? "Built in for the Cessna 172S"
    : !briefing ? undefined
      : short.length ? `Over the runway at ${short.join(", ")}` : "Within each runway";
  return (
    <AccordionSection
      title="Takeoff & Landing" summary={summary}
      finding={short.length ? "stop" : gusty.length ? "caution" : undefined}
      aside={short.length ? (
        <span className={cn("inline-flex items-center gap-1 font-semibold", FINDING_TONE.stop, TEXT.note)} data-testid="tl-flag">
          <OctagonAlert className="size-3.5" aria-hidden />
          Runway too short
        </span>
      ) : gusty.length ? (
        <span className={cn("inline-flex items-center gap-1 font-semibold", FINDING_TONE.caution, TEXT.note)} data-testid="crosswind-flag">
          <TriangleAlert className="size-3.5" aria-hidden />
          Crosswind
        </span>
      ) : undefined}
    >
      {!takeoffTable || !landingTable ? (
        <p className={cn("text-muted-foreground", TEXT.prose)}>The takeoff and landing distances are worked out for an airplane whose POH tables are built in: the Cessna 172S.</p>
      ) : !briefing ? (
        <p className="text-muted-foreground" role="status">Waiting on the runways and the weather at each field…</p>
      ) : (
        <div className="space-y-4" data-testid="takeoff-landing">
          {checks.map((c, i) => {
            const length = c.runway?.length_ft ?? null;
            return (
              <ListGroup
                key={`${c.field.ident}${i}`} title={`${c.field.ident} · ${c.role}`}
                footer={c.runway
                  ? `Runway ${c.runway.wind?.end ?? c.runway.ends} (${length != null ? `${altFt(length)} ft` : "length unknown"}${c.grass ? ", grass" : ""}): ${c.runway.wind ? "the one most into the wind" : "the longest, with no wind reported"}`
                  : "No runway data"}
              >
                {c.distances.map(d => (
                  <ListRow
                    key={d.kind}
                    media={<FindingIcon finding={length == null ? "unknown" : d.over ? "stop" : "ok"} />}
                    title={d.kind === "takeoff" ? "Takeoff" : "Landing"}
                    description={(
                      <>
                        {length != null && <RunwayBar distance={d} lengthFt={length} />}
                        <span className={cn("block", d.over && FINDING_TONE.stop)}>
                          {[`${altFt(d.groundRollFt)} ft roll`, length != null && (d.over ? `${altFt(d.totalFt - length)} ft past the end` : `${altFt(length)} ft runway`), ...d.caveats].filter(Boolean).join(" · ")}
                        </span>
                      </>
                    )}
                    value={`${altFt(d.totalFt)} ft`}
                    data-testid={`runway-${d.kind}`}
                  />
                ))}
                <ListRow
                  title="Density altitude"
                  description={`Pressure altitude ${altFt(c.pressureAltFt)} ft · ${Math.round(c.tempC)} °C ${c.reported ? "reported" : "(standard day; no report)"}`}
                  value={`${altFt(Math.round(c.densityAltFt / 10) * 10)} ft`}
                  data-testid="density-altitude"
                />
                <ListRow
                  media={c.crosswindOver ? <FindingIcon finding="caution" /> : undefined}
                  title="Wind"
                  description={c.runway?.wind
                    ? <span className={cn(c.crosswindOver && FINDING_TONE.caution)}>{runwayWind(c.runway.wind)}{c.crosswindOver && demonstrated && `: over the ${demonstrated.demonstrated_kt} kt the POH demonstrates`}</span>
                    : "None reported: the distances are for calm"}
                  data-testid="runway-wind-check"
                />
              </ListGroup>
            );
          })}
          <p className={cn("text-muted-foreground", TEXT.note)}>
            Distances over a 50 ft obstacle, from the POH&apos;s short-field tables{demonstrated ? " and its demonstrated crosswind" : ""}, in the wind and temperature reported now.
            Sources: {[takeoffTable.source, landingTable.source, demonstrated?.source].filter(Boolean).join("; ")}.
          </p>
        </div>
      )}
    </AccordionSection>
  );
}
