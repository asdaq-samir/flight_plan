import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Briefing, Leg } from "../../../../lib/api/types";
import { isPosition } from "../../../../lib/identSchema";
import { altFt } from "../../format";
import { phasesOf, type Phase } from "./sections";
import { FrequencyRow } from "../FrequencyRow";
import { PublicationRows } from "../PublicationRows";
import { RunwayRow } from "../RunwayRow";
import PatternRadio from "./PatternRadio";
import { fieldPhases } from "../../../../lib/radio";
import { useRunwayPicks } from "../../../../lib/useRunwayPicks";

/**
 * The Brief's airports: a section for each field the flight leaves or
 * lands at, in the order it does -- what the field is, its radio, its
 * runways and its publications, then its pattern and the calls there. A
 * tab of their own until the pilot asked for them under the Brief
 * (2026-10-12). It was two
 * sections each going through every field (the frequencies and runways,
 * then the patterns and calls), so a field's pattern was a screen away
 * from its runways; the Weather tab goes place by place the same way.
 * A route from the pilot's position (Fly Here's Direct-To) has no section
 * for the position, at the pilot's ask: a point in the air has no radio,
 * runways or pattern to list.
 */
export default function AirportSections({ briefing, landings, legs, callSign, phase }: {
  briefing: Briefing;
  /** Only the fields of this part of the flight (its tab's): the
   *  departure, the stops or the destination. */
  phase?: Phase;
  /** The fields landed at, in order, each once. */
  landings: string[];
  legs: Leg[];
  callSign: string;
}) {
  const picks = useRunwayPicks();
  return (
    <>
      {landings.map((ident, i) => {
        if (isPosition(ident) || (phase && !phasesOf(i, landings.length).includes(phase))) return null;
        const info = briefing.airports[ident];
        const role = landings.length === 1 ? "Local" : i === 0 ? "Departure" : i === landings.length - 1 ? "Destination" : "Stop";
        // What the field is; its pattern's altitude is the pattern's own to
        // say (PatternRadio), once.
        const about = [
          info?.name && info.name !== ident ? info.name : null,
          info?.airspace_class && `Class ${info.airspace_class}`,
          info?.elevation_ft != null && `${altFt(info.elevation_ft)} ft`,
        ].filter(Boolean).join(" · ");
        // The calls first, in the order they are made, each with its
        // frequency; then the frequencies no call is on, and the runways the
        // pattern is not flown to -- each said once, at the owner's pick of
        // the redesign, where every frequency and runway was listed, and
        // the calls and the pattern said them again.
        const phases = fieldPhases(briefing, landings, legs, callSign, ident, picks);
        const called = new Set(phases.flatMap(p => p.calls.map(c => c.mhz)).filter((m): m is number => m != null).map(m => m.toFixed(3)));
        const flown = new Set(phases.flatMap(p => (p.end ? [p.end.ident] : [])));
        const otherFrequencies = (info?.frequencies ?? []).filter(f => !(f.frequency_mhz != null && called.has(f.frequency_mhz.toFixed(3))));
        const otherRunways = (info?.runways ?? []).filter(r => !(r.runway_ends ?? []).some(e => flown.has(e.ident)));
        return (
          <AccordionSection key={ident} title={`${ident} · ${role}`} description={about || undefined}>
            <div className="space-y-4 pt-2" data-testid="airport-section">
              <PatternRadio briefing={briefing} landings={landings} legs={legs} callSign={callSign} at={ident} />
              {/* Each frequency as the field's card lists it (FrequencyRow):
                  its glyph and its name in words, the figure at the right. */}
              <ListGroup title={phases.length ? "Other frequencies" : "Radio"}>
                {otherFrequencies.length
                  ? otherFrequencies.map((f, k) => (
                    <FrequencyRow key={k} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="airport-frequency" />
                  ))
                  : <ListRow title={<span className="text-muted-foreground">{info?.frequencies.length ? "None but those on the calls" : "No published frequencies"}</span>} />}
              </ListGroup>
              <ListGroup title={flown.size ? "Other runways" : "Runways"}>
                {otherRunways.map((r, k) => <RunwayRow key={k} runway={r} />)}
                {!info?.runways.length && <ListRow title={<span className="text-muted-foreground">No published runway data</span>} />}
                <PublicationRows
                  ident={ident} diagram={info?.airport_diagram_url}
                  diagramCycle={info?.airport_diagram_cycle} supplement={info?.chart_supplement_url}
                />
              </ListGroup>
            </div>
          </AccordionSection>
        );
      })}
    </>
  );
}
