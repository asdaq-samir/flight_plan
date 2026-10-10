import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Cloud, Gauge, KeyRound, Radio, ShieldAlert } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { AirspaceBand } from "../../../lib/api/types";
import { degreesMinutes, minimumsLine, shortAirspaceName } from "../../../lib/airspace";
import type { LatLon } from "../../../lib/geo";
import { altFt } from "../../../lib/units";
import { TEXT } from "../../../lib/text";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { RowBadge } from "../../../components/RowBadge";
import { BADGE } from "../../../lib/rowBadges";

/** One of a band's rules on a line of its own, its glyph before it: the
 *  weather minimums, what it takes to go in, what the airplane carries,
 *  the speed limit -- each found at a glance, as the pilot asked of every
 *  card after Nearest's. */
function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-start gap-1.5">
      <span aria-hidden="true" className="mt-[0.2em] shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

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
  const rules: { icon: ReactNode; text: string }[] = [];
  if (m) rules.push({ icon: <Cloud />, text: sameDayNight ? `VFR ${minimumsLine(m.day)}` : `VFR by day ${minimumsLine(m.day)}; at night ${minimumsLine(m.night)}` });
  if (band.entry && band.entry !== "Nothing." && band.entry !== "Nothing for VFR.") rules.push({ icon: <KeyRound />, text: band.entry });
  if (band.equipment) rules.push({ icon: <Radio />, text: band.equipment });
  if (band.speed_kt) rules.push({ icon: <Gauge />, text: `${band.speed_kt} kt at most (91.117)` });
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
      title={<><span className="font-semibold">Class {band.class}</span>{band.name && <span className="text-muted-foreground"> · {shortAirspaceName(band.name)}</span>}</>}
      // The range first, the figure a pilot looks for; then the rules,
      // each with its glyph.
      description={(
        <span className="grid gap-0.5">
          <span className="font-semibold text-foreground tabular-nums">{range(band, ground)}</span>
          {rules.map(r => <Rule key={r.text} icon={r.icon}>{r.text}</Rule>)}
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
  const ground = data?.ground_ft ?? null;
  return (
    <PanelCard testId="airspace-card">
      <CardHead
        name="Airspace" line={<>{degreesMinutes(point)}{ground !== null && ` · ground ${altFt(ground)} ft`}</>}
        lineClassName="tabular-nums" lineTestId="airspace-where" onClose={onClose} closeTestId="airspace-close"
      />

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
                  media={<RowBadge colour={BADGE.rule}><Radio /></RowBadge>}
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
                      key={area.name} media={<RowBadge colour={BADGE.hazard}><ShieldAlert /></RowBadge>}
                      title={<><span className="font-semibold">{area.name}</span><span className="text-muted-foreground"> · {area.kind}</span></>}
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
                      media={<RowBadge colour={t.active_now ? BADGE.hazard : BADGE.other}><Ban /></RowBadge>}
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
    </PanelCard>
  );
}
