import { useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../../components/IconButton";
import { PanelHalfContext } from "../../../components/mapChrome";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { AirspaceBand } from "../../../lib/api/types";
import { degreesMinutes, minimumsLine, shortAirspaceName } from "../../../lib/airspace";
import type { LatLon } from "../../../lib/geo";
import { altFt } from "../../../lib/units";
import { TEXT } from "../../../lib/text";

/** The class's letter in the chart's own ink: solid blue for B, magenta
 *  for C, dashed blue for D, dashed magenta for E, none for G. */
const CLASS_STYLE: Record<AirspaceBand["class"], string> = {
  A: "border-muted-foreground text-muted-foreground",
  B: "border-[#1f5fa8] bg-[#1f5fa8] text-white dark:border-[#6fa8e6] dark:bg-[#6fa8e6] dark:text-black",
  C: "border-[#a1316f] bg-[#a1316f] text-white dark:border-[#e286bb] dark:bg-[#e286bb] dark:text-black",
  D: "border-dashed border-[#1f5fa8] text-[#1f5fa8] dark:border-[#6fa8e6] dark:text-[#6fa8e6]",
  E: "border-dashed border-[#a1316f] text-[#a1316f] dark:border-[#e286bb] dark:text-[#e286bb]",
  G: "border-border text-muted-foreground",
};

function range(band: AirspaceBand, ground: number | null): string {
  const bottom = ground !== null && band.floor_ft <= ground ? "Surface" : `${altFt(band.floor_ft)} ft`;
  const top = band.ceiling_ft >= 60000 ? "FL600" : `${altFt(band.ceiling_ft)} ft MSL`;
  return `${bottom} to ${top}`;
}

function BandRow({ band, ground }: { band: AirspaceBand; ground: number | null }) {
  const m = band.minimums;
  const sameDayNight = m && minimumsLine(m.day) === minimumsLine(m.night);
  const lines = [
    range(band, ground),
    m && (sameDayNight ? `VFR ${minimumsLine(m.day)}` : `VFR by day ${minimumsLine(m.day)}; at night ${minimumsLine(m.night)}`),
    band.entry !== "Nothing." && band.entry !== "Nothing for VFR." ? band.entry : null,
    band.equipment,
    band.speed_kt ? `${band.speed_kt} kt at most (91.117)` : null,
  ].filter(Boolean);
  return (
    <ListRow
      media={(
        <span
          className={cn("grid size-7 place-items-center rounded-md border-2 font-bold", TEXT.detail, CLASS_STYLE[band.class])}
          aria-hidden="true" data-testid="airspace-class"
        >
          {band.class}
        </span>
      )}
      title={band.name ? `Class ${band.class} · ${shortAirspaceName(band.name)}` : `Class ${band.class}`}
      // The range first, the figure a pilot looks for; then the rules.
      description={(
        <span className="grid gap-0.5">
          {lines.map((line, i) => <span key={line} className={cn(i === 0 && "font-medium text-foreground tabular-nums")}>{line}</span>)}
        </span>
      )}
      data-testid="airspace-band"
    />
  );
}

/**
 * The airspace over a point the pilot held a finger on, or right-clicked:
 * the chart's own question in the oral exam. From the ground up, each
 * class's altitudes (feet MSL), its VFR weather minimums by day and night
 * (91.155), what it takes to go in, what the airplane must carry and the
 * speed limit; then the Class B veil, the special-use areas and the TFRs
 * over it. Held in the address (`?at=42.3172,-88.0905`), as an airport's
 * card is (`?place=`).
 */
export default function AirspaceCard({ point, onClose }: { point: LatLon; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["airspaceAt", point.lat, point.lon], queryFn: () => api.airspaceAt(point.lat, point.lon),
    staleTime: 10 * 60_000,
  });
  // The heading whole at the panel's half height (PanelHalfContext), as
  // the airport's card does.
  const needs = useContext(PanelHalfContext);
  const [summary, setSummary] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!summary || !needs) return;
    const observer = new ResizeObserver(() => needs(summary.offsetTop + summary.offsetHeight + 120));
    observer.observe(summary);
    return () => { observer.disconnect(); needs(null); };
  }, [summary, needs]);
  const ground = data?.ground_ft ?? null;
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] print:hidden" data-testid="airspace-card">
      <div ref={setSummary} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.375rem] leading-7 font-bold tracking-tight text-foreground">Airspace</h2>
          <p className={cn("text-muted-foreground tabular-nums", TEXT.note)} data-testid="airspace-where">
            {degreesMinutes(point)}{ground !== null && ` · ground ${altFt(ground)} ft`}
          </p>
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2" data-testid="airspace-close">
          <X className="size-5" />
        </IconButton>
      </div>

      <div className="space-y-5 pt-4">
        {isLoading && <p className={cn("text-muted-foreground", TEXT.prose)}>Reading the airspace here…</p>}
        {isError && <p className={cn("text-destructive", TEXT.prose)}>The planner could not read the airspace here. Try again in a moment.</p>}
        {data && (
          <>
            <ListGroup
              title="From the ground up"
              footer={`Feet MSL, from the FAA's airspace file${ground !== null ? " and the ground's height there" : ""}. Check the chart: it is the authority.`}
            >
              {data.bands.map(band => <BandRow key={`${band.floor_ft}-${band.class}`} band={band} ground={ground} />)}
            </ListGroup>
            {data.mode_c_veil && (
              <ListGroup>
                <ListRow
                  title="In a Mode C veil"
                  description={`${data.mode_c_veil.distance_nm} nm from ${data.mode_c_veil.ident}: a transponder with altitude reporting and ADS-B Out from the surface to 10,000 ft (91.215, 91.225).`}
                  data-testid="airspace-veil"
                />
              </ListGroup>
            )}
            <ListGroup title="Special use">
              {data.special_use_unavailable
                ? <ListRow title={<span className="text-amber-700 dark:text-amber-300">The FAA's special-use airspace did not answer. Check the chart.</span>} />
                : data.special_use.length === 0
                  ? <ListRow title={<span className="text-muted-foreground">None here</span>} />
                  : data.special_use.map(area => (
                    <ListRow
                      key={area.name} title={`${area.name} · ${area.kind}`}
                      description={[
                        `${area.floor_ft == null ? "?" : area.floor_ft === 0 ? "Surface" : `${altFt(area.floor_ft)} ${area.floor_ref ?? ""}`.trim()} to ${area.ceiling_ft == null ? "?" : `${altFt(area.ceiling_ft)} ${area.ceiling_ref ?? ""}`.trim()}`,
                        area.times_of_use, area.controlling_agency,
                      ].filter(Boolean).join(" · ")}
                      data-testid="airspace-sua"
                    />
                  ))}
            </ListGroup>
            <ListGroup title="TFRs">
              {data.tfrs_unavailable
                ? <ListRow title={<span className="text-amber-700 dark:text-amber-300">tfr.faa.gov did not answer. Check it before flight.</span>} href="https://tfr.faa.gov" />
                : data.tfrs.length === 0
                  ? <ListRow title={<span className="text-muted-foreground">None here now or to come</span>} />
                  : data.tfrs.map(t => (
                    <ListRow
                      key={t.notam_id}
                      title={<span className={cn(t.active_now && "font-semibold text-red-700 dark:text-red-400")}>{`TFR ${t.notam_id}${t.kind ? ` · ${t.kind}` : ""}`}</span>}
                      description={[t.active_now ? "In force now" : "To come", t.title].filter(Boolean).join(" · ")}
                      href={`https://tfr.faa.gov/tfr3/?page=detail_${t.notam_id.replace("/", "_")}`}
                      data-testid="airspace-tfr"
                    />
                  ))}
            </ListGroup>
          </>
        )}
      </div>
    </div>
  );
}
