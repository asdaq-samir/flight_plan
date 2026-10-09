import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Briefing, Leg } from "../../../../lib/api/types";
import { altFt } from "../../format";
import { PublicationRows } from "../PublicationRows";
import { RunwayRow } from "../RunwayRow";
import PatternRadio, { RadioNote } from "./PatternRadio";

/** Frequency types by what a pilot calls them. The FAA's own
 *  description beside each is often the type again ("TWR (TWR)"), and
 *  is shown only when it adds something. */
const FREQUENCY_NAMES: Record<string, string> = {
  TWR: "Tower", GND: "Ground", ATIS: "ATIS", UNIC: "UNICOM", UNICOM: "UNICOM", CTAF: "CTAF",
  APP: "Approach", APCH: "Approach", DEP: "Departure", "A/D": "Approach and departure",
  CLD: "Clearance delivery", CD: "Clearance delivery", AWOS: "AWOS", ASOS: "ASOS", AFIS: "AFIS",
  FSS: "Flight service", MULT: "MULTICOM", MULTICOM: "MULTICOM", RDO: "Radio",
};

function frequencyName(type: string | null | undefined, description: string | null | undefined): { name: string; detail: string | null } {
  const code = (type ?? "").trim().toUpperCase();
  const name = FREQUENCY_NAMES[code] ?? type ?? description ?? "Frequency";
  const detail = description?.trim() ?? "";
  const redundant = !detail || [code, name.toUpperCase()].includes(detail.toUpperCase());
  return { name, detail: redundant ? null : detail };
}

/**
 * The Airports tab: a section for each field the flight leaves or lands
 * at, in the order it does -- what the field is, its radio, its runways
 * and its publications, then its pattern and the calls there. It was two
 * sections each going through every field (the frequencies and runways,
 * then the patterns and calls), so a field's pattern was a screen away
 * from its runways; the Weather tab goes place by place the same way.
 */
export default function AirportSections({ briefing, landings, legs, callSign }: {
  briefing: Briefing;
  /** The fields landed at, in order, each once. */
  landings: string[];
  legs: Leg[];
  callSign: string;
}) {
  return (
    <>
      {landings.map((ident, i) => {
        const info = briefing.airports[ident];
        const role = landings.length === 1 ? "Local" : i === 0 ? "Departure" : i === landings.length - 1 ? "Destination" : "Stop";
        const about = [
          info?.name && info.name !== ident ? info.name : null,
          info?.airspace_class && `Class ${info.airspace_class}`,
          info?.elevation_ft != null && `${altFt(info.elevation_ft)} ft`,
          info?.pattern?.altitude_ft != null && `pattern ${altFt(info.pattern.altitude_ft)} ft`,
        ].filter(Boolean).join(" · ");
        return (
          <AccordionSection key={ident} title={`${ident} · ${role}`} description={about || undefined}>
            <div className="space-y-4 pt-2" data-testid="airport-section">
              <ListGroup title="Radio">
                {info?.frequencies.length
                  ? info.frequencies.map((f, k) => {
                    const { name, detail } = frequencyName(f.type, f.description);
                    return <ListRow key={k} title={name} description={detail ?? undefined} value={f.frequency_mhz ?? "—"} />;
                  })
                  : <ListRow title={<span className="text-muted-foreground">No published frequencies</span>} />}
              </ListGroup>
              <ListGroup title="Runways">
                {info?.runways.length
                  ? info.runways.map((r, k) => <RunwayRow key={k} runway={r} />)
                  : <ListRow title={<span className="text-muted-foreground">No published runway data</span>} />}
                <PublicationRows
                  ident={ident} diagram={info?.airport_diagram_url}
                  diagramCycle={info?.airport_diagram_cycle} supplement={info?.chart_supplement_url}
                />
              </ListGroup>
              <PatternRadio briefing={briefing} landings={landings} legs={legs} callSign={callSign} at={ident} />
            </div>
          </AccordionSection>
        );
      })}
      {landings.length > 1 && <RadioNote />}
    </>
  );
}
