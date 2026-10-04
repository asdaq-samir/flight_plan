import { Suspense, lazy, useId } from "react";
import { cn } from "cn";
import { Check, TriangleAlert } from "lucide-react";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { Input } from "../../../../components/ui/input";
import type { AircraftProfile, Briefing, Course } from "../../../../lib/api/types";
import { isaTempC, pressureAltitudeFt, shortField } from "../../../../lib/takeoffLanding";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import { useLoad } from "../../hooks/useLoad";

/** The envelope's picture: Recharts, loaded with the section. */
const EnvelopeChart = lazy(() => import("./EnvelopeChart"));

const pounds = (n: number) => `${Math.round(n).toLocaleString("en-US")} lb`;

/** A number typed into a row: the stock field, short, its unit after it. */
function NumberField({ value, onChange, unit, label, testId }: {
  value: number; onChange: (n: number) => void; unit: string; label: string; testId?: string;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <Input
        id={id} type="number" inputMode="decimal" min={0} step="any" aria-label={label} data-testid={testId}
        className="h-8 w-24 text-right tabular-nums" value={Number.isFinite(value) ? value : ""}
        onChange={e => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      <span className={cn("w-6 text-muted-foreground", TEXT.detail)}>{unit}</span>
    </span>
  );
}

/**
 * Weight and balance, as its POH's loading graph does it: the aeroplane's
 * empty weight and arm, each station's load and the fuel, and the
 * weight and centre of gravity at takeoff and at landing -- the trip's
 * fuel burned -- against the most it may weigh and its envelope. For an
 * aeroplane whose profile has its POH's loading (the 172S's).
 */
export function WeightBalanceSection({ aircraft, tripFuelGal }: { aircraft: AircraftProfile | null | undefined; tripFuelGal: number | null }) {
  const { loading, load, result, setLoad } = useLoad(aircraft, tripFuelGal);
  const summary = !result ? "Built in for the Cessna 172S"
    : `${pounds(result.takeoff.weightLb)} at ${result.takeoff.armIn.toFixed(1)} in${result.problems.length ? "" : " · within limits"}`;
  return (
    <AccordionSection
      title="Weight & Balance" summary={summary}
      aside={result && result.problems.length > 0 ? (
        <span className={cn("inline-flex items-center gap-1 font-semibold text-red-700 dark:text-red-400", TEXT.note)} data-testid="wb-flag">
          <TriangleAlert className="size-3.5" aria-hidden />
          Out of limits
        </span>
      ) : undefined}
    >
      {!loading || !load || !result ? (
        <p className={cn("text-muted-foreground", TEXT.prose)}>
          The weight and balance is worked out for an aeroplane whose loading is built in: the Cessna 172S, from its POH.
        </p>
      ) : (
        <div className="space-y-4" data-testid="weight-balance">
          <ListGroup title="The aeroplane" footer="From its own weight and balance record; the POH's sample aeroplane until set.">
            <ListRow title="Empty weight">
              <NumberField value={load.emptyWeightLb} unit="lb" label="Empty weight" onChange={n => setLoad({ ...load, emptyWeightLb: n })} testId="wb-empty-weight" />
            </ListRow>
            <ListRow title="Its arm">
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
              <ListRow media={<Check className="size-5 text-green-700 dark:text-green-400" />} title="Within the weight and the envelope" data-testid="wb-ok" />
            ) : result.problems.map(problem => (
              <ListRow key={problem} media={<TriangleAlert className="size-5 text-red-600 dark:text-red-400" />} title={<span className="text-red-700 dark:text-red-400">{problem}</span>} />
            ))}
          </ListGroup>
          <Suspense fallback={<div className="h-56" />}>
            <EnvelopeChart envelope={loading.envelope as [number, number][]} takeoff={result.takeoff} landing={result.landing} />
          </Suspense>
        </div>
      )}
    </AccordionSection>
  );
}

/**
 * The short-field distances at each airport the flight takes off from or
 * lands at, from its POH's tables: the field's pressure altitude (its
 * elevation and the altimeter reported) and temperature (reported, or a
 * standard day's), the weight from Weight & Balance, the reported wind on
 * the runway it favours, grass where the runway is -- against that
 * runway's length.
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
  const fields = course ? [course.departure, ...(course.stops ?? []).filter(s => s.kind !== "fix"), course.destination] : [];
  const rows = !briefing || !takeoffTable || !landingTable ? [] : fields.map((field, i) => {
    const metar = briefing.metars[field.ident] ?? null;
    const runways = briefing.airports[field.ident]?.runways ?? [];
    // The runway the wind favours most, or the longest without a wind.
    const runway = [...runways].sort((a, b) => (b.wind?.headwind_kt ?? -99) - (a.wind?.headwind_kt ?? -99) || (b.length_ft ?? 0) - (a.length_ft ?? 0))[0];
    const elevation = field.elevation_ft ?? 0;
    const pa = pressureAltitudeFt(elevation, metar?.altimeter_in_hg);
    const temp = metar?.temp_c ?? isaTempC(elevation);
    const headwind = runway?.wind?.headwind_kt ?? 0;
    const grass = /turf|grass|grs|dirt|gravel/i.test(runway?.surface ?? "");
    const kinds: ("takeoff" | "landing")[] = i === 0 ? ["takeoff"] : i === fields.length - 1 ? ["landing"] : ["landing", "takeoff"];
    return {
      field, runway, pa, temp, headwind, grass, reported: !!metar,
      distances: kinds.map(kind => ({
        kind,
        ...shortField(kind === "takeoff" ? takeoffTable : landingTable, pa, temp,
          (kind === "takeoff" ? takeoffWeight : landingWeight) ?? Math.max(...(kind === "takeoff" ? takeoffTable : landingTable).weights_lb),
          headwind, grass),
      })),
    };
  });
  const short = rows.flatMap(r => r.distances.filter(d => r.runway?.length_ft != null && d.totalFt > r.runway.length_ft!).map(() => r.field.ident));
  const summary = !takeoffTable ? "Built in for the Cessna 172S"
    : !briefing ? undefined
      : short.length ? `Over the runway at ${[...new Set(short)].join(", ")}` : "Within each runway";
  return (
    <AccordionSection
      title="Takeoff & Landing" summary={summary}
      aside={short.length ? (
        <span className={cn("inline-flex items-center gap-1 font-semibold text-red-700 dark:text-red-400", TEXT.note)} data-testid="tl-flag">
          <TriangleAlert className="size-3.5" aria-hidden />
          Runway too short
        </span>
      ) : undefined}
    >
      {!takeoffTable || !landingTable ? (
        <p className={cn("text-muted-foreground", TEXT.prose)}>The takeoff and landing distances are worked out for an aeroplane whose POH tables are built in: the Cessna 172S.</p>
      ) : (
        <div className="space-y-4" data-testid="takeoff-landing">
          {rows.map(r => (
            <ListGroup
              key={r.field.ident} title={r.field.ident}
              footer={[
                r.runway ? `Runway ${r.runway.wind?.end ?? r.runway.ends}, ${r.runway.length_ft != null ? `${altFt(r.runway.length_ft)} ft` : "length unknown"}${r.grass ? ", grass" : ""}` : "No runway data",
                `pressure altitude ${altFt(r.pa)} ft`,
                `${Math.round(r.temp)} °C${r.reported ? "" : " (a standard day's)"}`,
                r.headwind > 0 ? `${r.headwind} kt headwind` : r.headwind < 0 ? `${-r.headwind} kt tailwind` : "no wind",
              ].join(" · ")}
            >
              {r.distances.map(d => {
                const over = r.runway?.length_ft != null && d.totalFt > r.runway.length_ft;
                return (
                  <ListRow
                    key={d.kind}
                    media={over ? <TriangleAlert className="size-5 text-red-600 dark:text-red-400" /> : undefined}
                    title={<span className={cn(over && "text-red-700 dark:text-red-400")}>{d.kind === "takeoff" ? "Takeoff" : "Landing"}</span>}
                    description={[`Over 50 ft ${altFt(d.totalFt)} ft`, ...d.caveats].join(" · ")}
                    value={`${altFt(d.groundRollFt)} ft roll`}
                  />
                );
              })}
            </ListGroup>
          ))}
          <p className={cn("text-muted-foreground", TEXT.note)}>
            {takeoffTable.source}; {landingTable.source}. The wind and temperature are those reported now.
          </p>
        </div>
      )}
    </AccordionSection>
  );
}
