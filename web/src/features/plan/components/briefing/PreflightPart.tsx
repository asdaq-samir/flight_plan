import type { ReactNode } from "react";
import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { GROUP_HEADING } from "../../../../lib/text";
import type { NavLogAltitude, Totals } from "../../../../lib/api/types";
import type { FlightBriefing } from "../../hooks/useFlightBriefing";
import { ceilingAndVisibility } from "../../format";
import { identOf } from "../../../../lib/identSchema";
import { WeightBalanceSection } from "./PreflightSections";
import OnRouteRow from "./OnRouteRow";
import { faaWords, suaAltitudes, tfrAltitudes, tfrPage, tfrTimes } from "../../../../lib/advisories";
import { passLine, tfrWhen } from "../../../../lib/passTimes";
import { FINDING_TONE } from "../../../../lib/status";
import BriefChecks from "./BriefChecks";
import { Accordion } from "../../../../components/ui/accordion";
import { SectionsOpen } from "../../../../components/sectionLayout";
import PassengerBriefing from "./PassengerBriefing";
import { passengerMessage } from "../../../../lib/passengers";
import FuelSection from "./FuelSection";
import FlightPlanSection from "./FlightPlanSection";
import RiskAssessment from "./RiskAssessment";
import FindingIcon from "../../../../components/FindingIcon";
import MockOral from "./MockOral";
import { BriefingNarrativePrintBlock, Flag, PassNote, Pending, SUA_FINDING, SUA_WORDS } from "./BriefingBits";

/** Preflight's sections its checks' tiles open (BriefChecks): the
 *  airspace's, the risk's and the loading's. */
const TILE_SECTIONS = ["TFRs & Special Use", "Risk Assessment", "Fuel", "Weight & Balance"];

interface Props {
  vm: FlightBriefing;
  nav: NavLogAltitude | null;
  totals: Totals | null;
  dep: string;
  dest: string;
  depart: string;
  narrativeText: string | null;
  narrative?: ReactNode;
}

/** Preflight: the go / no-go first, then what is done before leaving --
 *  the airspace, the risk, the paperwork, the loading. */
export default function PreflightPart({ vm, nav, totals, dep, dest, depart, narrativeText, narrative }: Props) {
  const { items, landings, setFolds, printing, folds, assessment, briefingPendingMessage, ifr, planForms, briefing, pilot, planText } = vm;
  return (
    <>
      {/* The narrative, printed only: on screen it is the tab's own
          section (BriefNarrative). */}
      <BriefingNarrativePrintBlock text={narrativeText} />

      <BriefChecks
        items={items} flight={`${landings.join("-")}|${depart}`} here={TILE_SECTIONS}
        onOpen={section => setFolds(open => (open.includes(section) ? open : [...open, section]))}
      />
      {/* What a tile opens, and what is done before leaving -- the
          paperwork, the passengers -- a row each, at the owner's pick
          of the redesign: they were laid open, ten screens of them
          under the Go / No-Go. */}
      <h3 className={cn("mt-2 px-1 print:hidden", GROUP_HEADING)}>Before you go</h3>
      <SectionsOpen.Provider value={printing}>
      <Accordion type="multiple" value={folds} onValueChange={setFolds} data-testid="before-you-go">
      {narrative}

      <AirspaceSection vm={vm} />

      {/* What the briefing raised, and what only the pilot can say
          (lib/frat). */}
      <AccordionSection
        title="Risk Assessment"
        aside={assessment && assessment.level !== "low" ? (
          <Flag finding={assessment.level === "high" ? "stop" : "caution"} testId="risk-flag">
            {assessment.level === "high" ? "High risk" : "Risk raised"}
          </Flag>
        ) : undefined}
      >
        {!assessment ? <Pending>{briefingPendingMessage}</Pending> : <RiskAssessment assessment={assessment} />}
      </AccordionSection>

      {/* The loading, done at home: its envelope and what it changes. */}
      <FuelSection totals={totals} />
      <WeightBalanceSection aircraft={nav?.aircraft} tripFuelGal={totals?.fuel_gal ?? null} />

      {/* The FAA's flight plan form filled in from the plan, from an
          airport: a present position is a flight already flying. */}
      {identOf(dep) && totals && (
        <FlightPlanSection forms={planForms} ifr={ifr} />
      )}

      {/* The passengers' briefing (91.107), and the flight to send them. */}
      <PassengerBriefing
        flight={`${landings.join("-")}|${depart}`}
        message={passengerMessage({
          dep, dest, destName: briefing?.airports[dest]?.name ?? null,
          depart: depart ? new Date(depart) : null, eteMin: totals?.ete_min ?? null,
          weather: briefing?.metars[dest] ? [briefing.metars[dest]!.flight_category,
            ceilingAndVisibility(briefing.metars[dest]!.ceiling_ft ?? null, briefing.metars[dest]!.visibility_sm ?? null)]
            .filter(Boolean).join(", ") : null,
        })}
      />

      {/* The mock oral, the developer's until a CFI has reviewed its
          answers; never on paper. */}
      {pilot?.developer && briefing && (
        <div className="print:hidden">
          <AccordionSection title="Mock Oral">
            <MockOral plan={planText} />
          </AccordionSection>
        </div>
      )}
      </Accordion>
      </SectionsOpen.Provider>
    </>
  );
}

/** The TFRs within five miles of the route during the flight, from
 *  tfr.faa.gov -- one the route goes through when it is in force in red
 *  -- and the special-use areas the legs cross, with when the flight gets
 *  to each against its times of use. */
function AirspaceSection({ vm }: { vm: FlightBriefing }) {
  const { tfrsCrossed, specialUse, briefing, briefingPendingMessage, unchecked, passAt, tfrInForce } = vm;
  return (
    <AccordionSection
      title="TFRs & Special Use"
      aside={tfrsCrossed.length > 0 ? <Flag finding="stop" testId="tfr-flag">TFR on the route</Flag>
        : specialUse.some(s => s.when === "active") ? <Flag finding="caution" testId="sua-flag">Area in use</Flag> : undefined}
    >
      {!briefing ? <Pending>{briefingPendingMessage}</Pending> : (
        <div className="space-y-4">
          <div data-testid="tfrs">
            <ListGroup title="Temporary flight restrictions">
              {unchecked("tfrs") ? (
                <ListRow
                  media={<FindingIcon finding="caution" />}
                  title={<span className={FINDING_TONE.caution}>tfr.faa.gov did not answer — check it before flight</span>} href="https://tfr.faa.gov"
                />
              ) : briefing.tfrs.length === 0 ? (
                <ListRow media={<FindingIcon finding="ok" />} title="None within 5 nm of the route during the flight" />
              ) : briefing.tfrs.flatMap(t => {
                const pass = passAt(t.along_track_nm);
                const inForce = t.crosses && tfrInForce(t);
                return [
                  <ListRow
                    key={t.notam_id}
                    media={<FindingIcon finding={inForce ? "stop" : "caution"} />}
                    title={<span className={cn(inForce && cn("font-semibold", FINDING_TONE.stop))}>{`TFR ${t.notam_id}${t.kind ? ` · ${t.kind}` : ""}`}</span>}
                    description={
                      <>
                        {[tfrAltitudes(t), tfrTimes(t)].filter(Boolean).map(line => <span key={line} className="block">{line}</span>)}
                        {/* When the flight gets there, in the planner's words
                            on the row under where it placed it. */}
                        {!t.on_route?.legs.length && <PassNote when={pass && { pass, state: tfrWhen(t, pass) }} />}
                        {(t.purpose ?? t.rule) && <span className="block">{faaWords(t.purpose ?? t.rule)}</span>}
                      </>
                    }
                    value={t.crosses ? "On the route" : `${Math.round(t.along_track_nm)} nm along`}
                    href={tfrPage(t.notam_id)}
                  />,
                  t.on_route?.legs.length ? <OnRouteRow key={`${t.notam_id}-on`} on={t.on_route} briefing={briefing} hazardKey={`tfr-${t.notam_id}`} /> : null,
                ];
              })}
            </ListGroup>
          </div>
          {specialUse.length > 0 && (
            <div data-testid="special-use">
              {/* Times of use as the FAA publishes them, LOCAL read as
                  this device's time: whether each is active is flight
                  service's or the controlling agency's to say. */}
              <ListGroup title="Special-use airspace">
                {specialUse.map(({ area, pass, when }) => (
                  <ListRow
                    key={area.name}
                    media={<FindingIcon finding={SUA_FINDING[when] === "stop" ? "caution" : SUA_FINDING[when]} />}
                    title={`${faaWords(area.name)} · ${area.kind}`}
                    // How far along with the altitudes, not at the row's end:
                    // there it left the FAA's times of use three words a line.
                    description={
                      <>
                        <span className="block">{`${suaAltitudes(area)} · ${Math.round(area.along_track_nm)} nm along`}</span>
                        {area.times_of_use && <span className="block">In use: {faaWords(area.times_of_use)}</span>}
                        {pass && <span className="block" data-testid="sua-pass">{`You pass about ${passLine(pass)}: ${SUA_WORDS[when]}`}</span>}
                      </>
                    }
                    data-testid="special-use-area"
                  />
                ))}
              </ListGroup>
            </div>
          )}
        </div>
      )}
    </AccordionSection>
  );
}
