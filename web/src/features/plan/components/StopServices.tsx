import { useQuery } from "@tanstack/react-query";
import { BedDouble, CarFront, Cylinder, Fuel, Receipt, SquareParking, Utensils, Warehouse, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import { pointName } from "../../../lib/identSchema";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { PillSection } from "../../../components/Favorites";
import { FirstFew } from "../../../components/FirstFew";
import QueryState from "../../../components/QueryState";
import { RowBadge } from "../../../components/RowBadge";
import type { NearbyPlace } from "../../../lib/api/types";
import { awayWords, fuelNames, glanceOf, type GlanceItem, type Glanceable } from "../../../lib/stopServices";
import { servicesQuery } from "../../../lib/queryClient";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { duration } from "../../../lib/clock";

const GLANCE_ICONS: Record<GlanceItem["key"], ReactNode> = {
  fuel: <Fuel />, food: <Utensils />, bed: <BedDouble />, car: <CarFront />,
};

/** What a field has on the ground in a line of a few words (glanceOf), one
 *  look under a field and a suggested stop's row
 *  (StopGlance), where the two had their own sizes and colours: a note's
 *  size, in the muted grey, as the line under a row is. */
export function Glance({ of, className, testId }: { of: Glanceable; className?: string; testId: string }) {
  const items = glanceOf(of);
  if (!items.length) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-muted-foreground", TEXT.note, className)} data-testid={testId}>
      {items.map(item => (
        <span key={item.key} className="inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0">
          {GLANCE_ICONS[item.key]}{item.words}
        </span>
      ))}
    </span>
  );
}

/** A suggested stop's glance, from the field's services once they are in;
 *  nothing until then, or where none is near. */
export function StopGlance({ ident, className }: { ident: string; className?: string }) {
  const { data } = useQuery(servicesQuery(ident));
  return data ? <Glance of={data} className={className} testId="stop-glance" /> : null;
}

/** A section of the airport card's, titled as its frequencies and lights
 *  are (PillSection), after them. */
function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="pt-5" data-testid={testId}>
      <PillSection title={title}><ListGroup>{children}</ListGroup></PillSection>
    </div>
  );
}

/** A section of rows, the first three and its title the rest (FirstFew),
 *  as the card's Frequencies. */
function FewSection({ title, rows, testId }: { title: string; rows: ReactNode[]; testId?: string }) {
  return (
    <div className="pt-5" data-testid={testId}>
      <FirstFew title={title} rows={rows} testId={testId && `${testId}-section`} />
    </div>
  );
}

// A tap opens the place's own website, its photos and menu there, at the
// owner's word ("links are fine for now for the places", where Google's
// photos wait on its key, #210); a place with none calls it, where it has
// a phone.
const placeRows = (places: NearbyPlace[], media: ReactNode, testId: string) => places.map(p => (
  <ListRow
    key={`${p.name}-${p.lat}`} media={media} title={p.name} description={p.kind}
    value={<span className="tabular-nums">{awayWords(p)}</span>}
    href={p.website ?? (p.phone ? `tel:${p.phone}` : undefined)} data-testid={testId}
  />
));

/**
 * What the field offers a pilot who lands there, at the foot of the
 * airport card (PlaceCard), at the owner's ask for food, fuel and rest stops on a
 * long cross-country: the fuel and its remarks, what is on the field --
 * parking, a hangar, repair, oxygen, a landing fee, a courtesy car -- from
 * its Chart Supplement entry, then the places to eat, sleep and hire a car
 * within five miles, nearest first (vfr.nearby). A place with a phone is
 * a tap that calls it.
 */
export function StopServices({ ident, withoutFuel = false }: {
  ident: string;
  /** Its fuel left to the airport card's details, which show it. */
  withoutFuel?: boolean;
}) {
  const asked = useQuery(servicesQuery(ident));
  const s = asked.data;
  // A line while they are fetched, and where they could not be, that they
  // could not with Try again, as every list says it (QueryState), where
  // the wait was blank and the failure had no way to ask again.
  if (!s) {
    return (
      <Section title="Services">
        <QueryState row query={asked} fetching="Fetching the services…" failed="The services could not be fetched." />
      </Section>
    );
  }
  const repair = [s.airframe_repair && `airframe ${s.airframe_repair}`, s.powerplant_repair && `engine ${s.powerplant_repair}`].filter(Boolean).join(", ");
  const field = [
    s.courtesy_car && (
      <ListRow
        key="car" media={<RowBadge colour={BADGE.car}><CarFront /></RowBadge>} title="Courtesy car"
        description={s.ground_notes.join(" ")} data-testid="services-courtesy-car"
      />
    ),
    s.tie_down && <ListRow key="tie" media={<RowBadge colour={BADGE.runway}><SquareParking /></RowBadge>} title="Tie-downs" />,
    s.hangar && <ListRow key="hangar" media={<RowBadge colour={BADGE.runway}><Warehouse /></RowBadge>} title="Hangars" />,
    repair && <ListRow key="repair" media={<RowBadge colour={BADGE.other}><Wrench /></RowBadge>} title="Repair" value={repair} />,
    s.oxygen && <ListRow key="oxygen" media={<RowBadge colour={BADGE.other}><Cylinder /></RowBadge>} title="Oxygen" />,
    s.landing_fee != null && (
      <ListRow key="fee" media={<RowBadge colour={BADGE.other}><Receipt /></RowBadge>} title="Landing fee" value={s.landing_fee ? "Yes" : "None"} />
    ),
  ].filter(Boolean);
  const near = s.food.length + s.lodging.length + s.cars.length > 0;
  return (
    <div data-testid="place-services">
      {!withoutFuel && (
        <Section title="Fuel">
          <ListRow
            media={<RowBadge colour={BADGE.fuel}><Fuel /></RowBadge>}
            title={s.fuel_types.length ? fuelNames(s.fuel_types) : <span className="text-muted-foreground">None listed</span>}
            data-testid="services-fuel"
          />
          {/* The remarks in plain English as the planner gives them
              (vfr.remarks.service_notes): self-serve, its hours, the FBO's. */}
          {s.fuel_notes.map(note => <ListRow key={note} title={note} />)}
        </Section>
      )}
      {field.length > 0 && <FewSection title="On the field" rows={field} />}
      {s.food.length > 0 && <FewSection title="Food nearby" rows={placeRows(s.food, <RowBadge colour={BADGE.food}><Utensils /></RowBadge>, "services-food")} />}
      {s.lodging.length > 0 && <FewSection title="Places to stay" rows={placeRows(s.lodging, <RowBadge colour={BADGE.lodging}><BedDouble /></RowBadge>, "services-lodging")} />}
      {/* Overture's credit under its places, as its licence asks: the
          data's, not a note (the owner's no-footnotes rule keeps these). */}
      {s.cars.length > 0 && <FewSection title="Car rental" rows={placeRows(s.cars, <RowBadge colour={BADGE.car}><CarFront /></RowBadge>, "services-cars")} />}
      {near && <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>}
      {s.nearby_unavailable && (
        <Section title="Nearby"><ListRow muted title="Places near the field could not be looked up" /></Section>
      )}
    </div>
  );
}

/** A stop the planner suggests, as the airport's card opened on it shows
 *  it (PlaceCard's `stop`): why, from where, and what the airplane lands
 *  there with. */
export type SuggestedStop = {
  reason: "fuel" | "break";
  /** The field the flight to it leaves, and its minutes from there. */
  from: string;
  minutes: number;
  landsWithGal: number;
  addedNm: number;
};

/** The suggested stop's figures, at the top of its airport's card, at the
 *  owner's pick of the canvas's stop card: when it is reached, the fuel
 *  it lands with and the miles it adds, three tiles, then what is there on
 *  the ground in a line (StopGlance) -- the rest at the card's foot. */
export function StopStrip({ ident, stop }: { ident: string; stop: SuggestedStop }) {
  const tile = (label: string, value: string, testId: string) => (
    <div className="min-w-0 rounded-xl bg-foreground/5 px-2.5 py-1.5" data-testid={testId}>
      <div className={cn("truncate text-muted-foreground", TEXT.note)}>{label}</div>
      <div className={cn("truncate font-semibold tabular-nums", TEXT.row)}>{value}</div>
    </div>
  );
  return (
    <div className="pt-3" data-testid="place-stop">
      <PillSection title={stop.reason === "break" ? "Suggested break" : "Suggested fuel stop"}>
        <div className="grid grid-cols-3 gap-2">
          {tile(`From ${pointName(stop.from)}`, duration(stop.minutes), "place-stop-after")}
          {tile("Lands with", `${Math.floor(stop.landsWithGal)} gal`, "place-stop-fuel")}
          {tile("Off the line", `+${Math.round(stop.addedNm)} nm`, "place-stop-added")}
        </div>
        <StopGlance ident={ident} />
      </PillSection>
    </div>
  );
}
