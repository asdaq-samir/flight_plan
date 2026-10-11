import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Briefing, Leg } from "../../../../lib/api/types";
import { isPosition } from "../../../../lib/identSchema";
import { altFt } from "../../format";
import { FrequencyRow } from "../FrequencyRow";
import { PublicationRows } from "../PublicationRows";
import { RunwayRow } from "../RunwayRow";
import PatternRadio, { RadioNote } from "./PatternRadio";

/**
 * The Airports tab: a section for each field the flight leaves or lands
 * at, in the order it does -- what the field is, its radio, its runways
 * and its publications, then its pattern and the calls there. It was two
 * sections each going through every field (the frequencies and runways,
 * then the patterns and calls), so a field's pattern was a screen away
 * from its runways; the Weather tab goes place by place the same way.
 * A route from the pilot's position (Fly Here's Direct-To) has no section
 * for the position, at the pilot's ask: a point in the air has no radio,
 * runways or pattern to list.
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
        if (isPosition(ident)) return null;
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
              {/* Each frequency as the field's card lists it (FrequencyRow):
                  its glyph and its name in words, the figure at the right. */}
              <ListGroup title="Radio">
                {info?.frequencies.length
                  ? info.frequencies.map((f, k) => (
                    <FrequencyRow key={k} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="airport-frequency" />
                  ))
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
