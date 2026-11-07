import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AirspaceVolume } from "../api/types";
import { cn } from "cn";
import { TEXT } from "../text";
import { airspaceFacts } from "./airspaceLabel";
import { AIRSPACE_LINE } from "./airspaceMarks";
import { MapCard } from "./MapCard";
import { Button } from "../../components/ui/button";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { callTypes, entryRules } from "../airspaceRules";
import { mhzText } from "../frequencies";
import { airportQuery } from "../queryClient";
import { usePointActions } from "./pointActions";
import type { Box } from "./view";

/**
 * The Class B, C and D as the map asks for them and the card a tap on one
 * of their lines opens (the map draws them: lib/map/gl/layers/AirspaceGl):
 * each volume's line from the FAA's own airspace file -- the one the
 * chart is drawn from -- with its altitudes, and its card: its class,
 * name, floor, ceiling and hours, who to call and what it takes to go in
 * (the owner, 2026-10-29: "make the airspace rings selectable with more
 * info").
 */

/** From this zoom in, as the airports' and the VFR waypoints', the Class
 *  C and D and every label: further out they are a scatter of small rings
 *  over a few states. */
const FROM_ZOOM = 8;
/** The Class B's lines from a few states' zoom, as the airline airports'
 *  marks are (AirportsLayer), at the owner's ask (2026-10-29, "Maybe
 *  class B from 4?", then two levels in from that): the big rings a pilot
 *  plans round, there before anything else. Unlabelled until FROM_ZOOM. */
const CLASS_B_FROM_ZOOM = 6;
/** The Class C's lines a zoom before the D's, at the owner's ask
 *  (2026-10-29, "Show c airspace from 7"); unlabelled until FROM_ZOOM. */
const CLASS_C_FROM_ZOOM = 7;

/** The volumes already drawn, by their id and the box's height their
 *  lines were simplified for (the planner's tolerance_for): a pan into a
 *  new box answers with the same rings, and each kept as the same object
 *  is not projected again (AirspaceLinesLayer, by the object) nor its tap
 *  made again (VolumeTap is memo). New objects, every ring on the map was
 *  taken off its line and put back, its tap too, at each box a pan or a
 *  pinch asked for. */
const drawn = new Map<string, AirspaceVolume>();
/** The most kept, a few states' worth, before they are let go. */
const MOST_KEPT = 3000;

function kept(volumes: AirspaceVolume[], box: { south: number; north: number }): AirspaceVolume[] {
  if (drawn.size > MOST_KEPT) drawn.clear();
  const height = box.north - box.south;
  return volumes.map(v => {
    const key = `${v.id}|${height}`;
    const was = drawn.get(key);
    if (was) return was;
    drawn.set(key, v);
    return v;
  });
}

/** The planner asked for a box's volumes, once per box and classes (the
 *  query cache): the lines' layer, the altitudes and the taps share it,
 *  and the map's own events ask it as they happen (useAhead). The Class B
 *  from CLASS_B_FROM_ZOOM, the C too from CLASS_C_FROM_ZOOM and the D from
 *  FROM_ZOOM; none where the settings' Airspace is off. */
export function airspaceQuery(asked: Box, zoom: number, show: boolean) {
  const classes = zoom >= FROM_ZOOM ? "BCD" : zoom >= CLASS_C_FROM_ZOOM ? "BC" : "B";
  return {
    queryKey: ["airspaceInView", asked.key, classes],
    queryFn: () => api.airspaceInView({ ...asked.box, classes }).then(volumes => kept(volumes, asked.box)),
    enabled: show && zoom >= CLASS_B_FROM_ZOOM,
    staleTime: Infinity,
    meta: { silent: true },
  };
}

/** A short length of the volume's line as the map draws it, before its
 *  title: solid blue, solid magenta or dashed blue. */
function Swatch({ volume }: { volume: AirspaceVolume }) {
  const line = AIRSPACE_LINE[volume.airspace_class];
  return (
    <svg aria-hidden="true" width="28" height="8" viewBox="0 0 28 8" className="mx-1 shrink-0">
      <line x1="0" y1="4" x2="28" y2="4" stroke={line.color} strokeWidth={line.weight} strokeDasharray={typeof line.dashArray === "string" ? line.dashArray : undefined} />
    </svg>
  );
}

/** A volume's card on whichever map opened it: `close` puts it away
 *  before the route is planned round the Class B (Leaflet's popup here,
 *  the WebGL map's sheet card in GlMap). */
export function AirspaceCardBody({ volume, close }: { volume: AirspaceVolume; close: () => void }) {
  const avoid = usePointActions(s => s.avoidClassB);
  const facts = airspaceFacts(volume);
  const rows: [string, string][] = [["Floor", facts.floor], ["Ceiling", facts.ceiling]];
  if (facts.hours) rows.push(["Hours", facts.hours]);
  return (
    <MapCard
      media={<Swatch volume={volume} />} title={`Class ${volume.airspace_class}`} subtitle={facts.name}
      // In the pill its name and place on the ring's own colour, as an
      // airport's is its picture (MapCard's `pill`).
      pill={{ name: `Class ${volume.airspace_class}`, line: facts.name, colour: AIRSPACE_LINE[volume.airspace_class].color }}
    >
      <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left", TEXT.row)} data-testid="airspace-card">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <AirspaceCall volume={volume} />
      {/* What it takes to go in, each rule with its section (lib/airspaceRules),
          at the owner's ask for cards that say what a pilot does there
          (2026-10-30). */}
      <div data-testid="airspace-rules">
        <ListGroup title="To enter">
          {entryRules(volume.airspace_class).map(r => (
            <ListRow key={r.rule} title={<span className={TEXT.detail}>{r.rule}</span>} description={r.cite} />
          ))}
        </ListGroup>
      </div>
      {volume.airspace_class === "B" && avoid && (
        <Button type="button" variant="secondary" className="w-full text-tint" onClick={() => { close(); avoid(); }} data-testid="airspace-avoid">
          Route Around Class B
        </Button>
      )}
    </MapCard>
  );
}

/** Who to call before entering, from the primary airport's frequencies
 *  (NASR FRQ): its approach control for a Class B or C, its tower for a
 *  Class D; the first three. */
function AirspaceCall({ volume }: { volume: AirspaceVolume }) {
  const { data: field } = useQuery({ ...airportQuery(volume.ident ?? ""), enabled: !!volume.ident });
  const types = callTypes(volume.airspace_class);
  const calls = (field?.frequencies ?? []).filter(f => f.frequency_mhz != null && types.includes((f.type ?? "").toUpperCase()));
  // Approach where it has one, else the tower.
  const first = types.find(type => calls.some(f => f.type?.toUpperCase() === type));
  const shown = calls.filter(f => f.type?.toUpperCase() === first).slice(0, 3);
  if (!shown.length) return null;
  return (
    <div data-testid="airspace-call">
      <ListGroup title={first === "APP" ? "Call approach" : "Call the tower"}>
        {shown.map((f, i) => (
          <ListRow
            key={`${f.frequency_mhz}-${i}`} title={<span className={TEXT.detail}>{f.description ?? f.type}</span>}
            value={<span className="font-semibold text-foreground tabular-nums">{mhzText(f.frequency_mhz!)}</span>}
          />
        ))}
      </ListGroup>
    </div>
  );
}

