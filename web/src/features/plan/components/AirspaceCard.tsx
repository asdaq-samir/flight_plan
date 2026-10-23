import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Cloud, Gauge, KeyRound, MoveUpRight, Plus, Radio, Repeat2, ShieldAlert } from "lucide-react";
import { cn } from "cn";
import { PillSection } from "../../../components/Favorites";
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
import { FINDING_TONE } from "../../../lib/status";
import { faaWords, suaAltitudes } from "../../../lib/advisories";

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
export default function AirspaceCard({ point, onClose, summary = false, onExpand, onAdd, onDirect, onHold }: {
  point: LatLon;
  onClose: () => void;
  /** The point into the route, as the pilot's own point off the nearest
   *  fix ("VPBNG/095/14.2", the planner's vfr.fixes.frd_near), at the
   *  owner's pick of the canvas's dropped point: where it bends the route
   *  least, flown to direct, or held at. None where there is no route to
   *  put it in, or no fix to name it off. */
  onAdd?: (ident: string, at: LatLon) => void;
  onDirect?: (ident: string, at: LatLon) => void;
  onHold?: (ident: string, at: LatLon) => void;
  /** At the panel's minimal size, as a held point opens: its first
   *  layers, the rest a swipe up (the airport card's summary). */
  summary?: boolean;
  onExpand?: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["airspaceAt", point.lat, point.lon], queryFn: () => api.airspaceAt(point.lat, point.lon),
    staleTime: 10 * 60_000,
  });
  const ground = data?.ground_ft ?? null;
  const named = data?.point ?? null;
  const actions = named ? [
    { go: onAdd, label: "Add to Route", icon: <Plus />, testId: "point-add" },
    { go: onDirect, label: "Direct To", icon: <MoveUpRight />, testId: "point-direct" },
    { go: onHold, label: "Hold Here", icon: <Repeat2 />, testId: "point-hold" },
  ].filter(a => a.go) : [];
  return (
    <PanelCard testId="airspace-card">
      <CardHead
        name="Airspace" line={<>{degreesMinutes(point)}{ground !== null && ` · ground ${altFt(ground)} ft`}{named && <><br />{named.ident} · {named.name}</>}</>}
        lineClassName="tabular-nums" lineTestId="airspace-where" onClose={onClose} closeTestId="airspace-close"
      />
      {/* The point into the route, as Maps' dropped pin's card offers its
          directions: the first the tint's, the others its wash. */}
      {named && actions.length > 0 && (
        <div className="grid grid-cols-3 gap-2 pt-3" data-testid="point-actions">
          {actions.map((a, i) => (
            <button
              key={a.testId} type="button" onClick={() => a.go!(named.ident, point)} data-testid={a.testId}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5",
                TEXT.note, i === 0 ? "bg-primary text-primary-foreground" : "bg-foreground/6 text-tint",
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* The layers under the head at every size, from the ground up: at
          the pill's size the lowest two, the title the way up; all the way
          up every one in the same place, the rest under them, so the top
          stays as it was (the owner's ask). */}
      {data && (
        <div className="pt-3">
          <PillSection title="Airspace here" onMore={summary ? onExpand : undefined} testId="airspace-summary">
            {/* Feet MSL (each range says so), from the FAA's airspace file
                and the ground's height there: the chart is the authority. */}
            <ListGroup>
              {(summary ? data.bands.slice(0, 2) : data.bands).map(band => <BandRow key={`${band.floor_ft}-${band.class}`} band={band} ground={ground} />)}
            </ListGroup>
          </PillSection>
        </div>
      )}
      {!summary && <div className="space-y-5 pt-4">
        {isLoading && <p className={cn("text-muted-foreground", TEXT.prose)}>Fetching the airspace here…</p>}
        {isError && <p className={cn("text-destructive", TEXT.prose)}>The planner could not read the airspace here. Try again in a moment.</p>}
        {data && (
          <>
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
                ? <ListRow title={<span className="text-caution-ink">The FAA's special-use airspace did not answer. Check the chart.</span>} />
                : data.special_use.length === 0
                  ? <ListRow muted title="None here" />
                  : data.special_use.map(area => (
                    <ListRow
                      key={area.name} media={<RowBadge colour={BADGE.hazard}><ShieldAlert /></RowBadge>}
                      title={<><span className="font-semibold">{faaWords(area.name)}</span><span className="text-muted-foreground"> · {area.kind}</span></>}
                      description={[
                        suaAltitudes(area),
                        area.times_of_use, area.controlling_agency,
                      ].filter(Boolean).join(" · ")}
                      data-testid="airspace-sua"
                    />
                  ))}
            </ListGroup>
            <ListGroup title="TFRs">
              {data.tfrs_unavailable
                ? <ListRow title={<span className="text-caution-ink">tfr.faa.gov did not answer. Check it before flight.</span>} href="https://tfr.faa.gov" />
                : data.tfrs.length === 0
                  ? <ListRow muted title="None here now or to come" />
                  : data.tfrs.map(t => (
                    <ListRow
                      key={t.notam_id}
                      media={<RowBadge colour={t.active_now ? BADGE.hazard : BADGE.other}><Ban /></RowBadge>}
                      title={<span className={cn(t.active_now && cn("font-semibold", FINDING_TONE.stop))}>{`TFR ${t.notam_id}${t.kind ? ` · ${t.kind}` : ""}`}</span>}
                      description={[t.active_now ? "In force now" : "To come", t.title].filter(Boolean).join(" · ")}
                      href={`https://tfr.faa.gov/tfr3/?page=detail_${t.notam_id.replace("/", "_")}`}
                      data-testid="airspace-tfr"
                    />
                  ))}
            </ListGroup>
          </>
        )}
      </div>}
    </PanelCard>
  );
}
