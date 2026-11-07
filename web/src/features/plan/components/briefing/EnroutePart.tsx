import { cn } from "cn";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { TEXT } from "../../../../lib/text";
import type { Course, Leg } from "../../../../lib/api/types";
import type { FlightBriefing } from "../../hooks/useFlightBriefing";
import { altFt, ceilingAndVisibility, clockTime, windAloft } from "../../format";
import OnRouteRow from "./OnRouteRow";
import { faaWords, gairmetAltitudes, gairmetTitle, sigmetHazard } from "../../../../lib/advisories";
import WeatherAlongRoute from "./WeatherAlongRoute";
import FindingIcon from "../../../../components/FindingIcon";
import { Flag, hazardAltitudeRange, Pending } from "./BriefingBits";

interface Props {
  vm: FlightBriefing;
  course: Course | null;
  legs: Leg[];
  depart: string;
}

/** En route, under the legs and the side view: the weather on the way --
 *  adverse conditions first (AIM 7-1-5), then stretch by stretch, then
 *  the winds. */
export default function EnroutePart({ vm, course, legs, depart }: Props) {
  const { briefing, briefingPendingMessage, unchecked, opened } = vm;
  return (
    <>
      <AdverseConditions vm={vm} />

      {briefing && course ? (
        <WeatherAlongRoute briefing={briefing} course={course} legs={legs} departIso={depart || opened} unchecked={unchecked} phase="enroute" />
      ) : (
        <AccordionSection title="Along the Route"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
      )}

      <WindsAloft vm={vm} legs={legs} />
    </>
  );
}

function AdverseConditions({ vm }: { vm: FlightBriefing }) {
  const { vnrReasons, underMine, icing, hazardNames, briefing, briefingPendingMessage, unchecked } = vm;
  return (
    <AccordionSection
      title="Adverse Conditions"
      // On the title, seen before anything under it: VFR not
      // recommended, or short of that, under the pilot's own minimums.
      aside={vnrReasons.length > 0 ? <Flag finding="stop" testId="vnr-flag">VFR not recommended</Flag>
        : underMine.length > 0 ? <Flag finding="stop" testId="minimums-flag">Under your minimums</Flag>
          : icing ? <Flag finding="caution" testId="icing-flag">Icing possible</Flag>
          : hazardNames.length > 0 ? <Flag finding="caution" testId="hazards-flag">{hazardNames.length === 1 ? "A hazard" : `${hazardNames.length} hazards`}</Flag> : undefined}
    >
      {/* Its own standard element (AIM 7-1-5(b)), stated first, the
          way a live briefer states it before the detail that
          justifies it. Red on pale red at 7:1, in both themes. */}
      {vnrReasons.length > 0 && (
        <Alert className={cn("mb-2 border-destructive/30 bg-destructive/10 text-destructive-ink", TEXT.prose)}>
          <OctagonAlert />
          <AlertTitle>VFR flight not recommended</AlertTitle>
          <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
            {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </Alert>
      )}
      {underMine.length > 0 && (
        <Alert className={cn("mb-2 border-destructive/30 bg-destructive/10 text-destructive-ink", TEXT.prose)} data-testid="minimums-alert">
          <OctagonAlert />
          <AlertTitle>Under your personal minimums</AlertTitle>
          <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
            {underMine.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </Alert>
      )}
      {icing && (
        // Under IFR, in cloud at or above the freezing level.
        <Alert className={cn("mb-2 border-caution/30 bg-caution-wash text-caution-ink", TEXT.prose)} data-testid="icing-alert">
          <TriangleAlert />
          <AlertTitle>Icing possible at {altFt(icing.altitudeFt)} ft</AlertTitle>
          <AlertDescription className={cn("text-caution-ink", TEXT.prose)}>
            <p>
              The freezing level is {icing.atOrBelow ? "at or below" : "at"} {altFt(icing.freezingLevelFt)} ft, with cloud
              or an icing AIRMET forecast along the route{icing.reports
                ? `, and ${icing.reports} pilot report${icing.reports === 1 ? "" : "s"} of icing near it` : ""}.
              Most light airplanes&apos; flight manuals prohibit flight into known icing, and the manual&apos;s
              limitations bind (14 CFR 91.9(a)): plan below the freezing level, or an airplane certified for it.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {!briefing ? <Pending>{briefingPendingMessage}</Pending>
        : unchecked("hazards") && unchecked("gairmets") ? (
          <p className="text-caution-ink">
            SIGMET and G-AIRMET data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : (
          // A row a SIGMET or G-AIRMET, marked with the warning
          // triangle. The G-AIRMETs replaced the text AIRMETs in 2025:
          // the snapshot nearest the departure, one per hazard.
          <ListGroup>
            {briefing.hazards.length + briefing.gairmets.length === 0 && (
              <ListRow media={<FindingIcon finding="ok" />} title="No SIGMETs or G-AIRMETs along the route during the flight" />
            )}
            {briefing.hazards.flatMap((h, i) => [
              <ListRow
                key={`s${i}`}
                media={<FindingIcon finding="caution" />}
                title={`${sigmetHazard(h.hazard, h.type)}${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)
                  ? ` — ${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)}` : ""}`}
                description={h.raw && <span className="font-mono whitespace-pre-wrap">{h.raw}</span>}
                data-testid="sigmet"
              />,
              h.on_route?.legs.length ? <OnRouteRow key={`s${i}-on`} on={h.on_route} briefing={briefing} hazardKey={`sigmet-${i}-${h.raw ?? ""}`} /> : null,
            ])}
            {briefing.gairmets.flatMap((g, i) => [
              <ListRow
                key={`g${i}`}
                media={<FindingIcon finding="caution" />}
                title={gairmetTitle(g)}
                description={[gairmetAltitudes(g), faaWords(g.due_to), g.valid_at && `G-AIRMET for ${clockTime(new Date(g.valid_at))}`]
                  .filter(Boolean).join(" · ")}
                data-testid="gairmet"
              />,
              g.on_route?.legs.length ? <OnRouteRow key={`g${i}-on`} on={g.on_route} briefing={briefing} hazardKey={`gairmet-${g.hazard}`} /> : null,
            ])}
            {/* The fields below VFR where the flight meets them: a
                field's report now, a TAF's for when the airplane is
                there (the planner's, app.exposure). */}
            {(briefing.fields_below_vfr ?? []).flatMap(f => [
              <ListRow
                key={`f${f.ident}${f.source}`}
                media={<FindingIcon finding="caution" />}
                title={`${f.ident} below VFR · ${f.source === "METAR" ? `${f.flight_category ?? "IFR"} now` : "forecast then"}`}
                description={ceilingAndVisibility(f.ceiling_ft, f.visibility_sm).replace(/^./, c => c.toUpperCase())}
                data-testid="field-below-vfr"
              />,
              <OnRouteRow key={`f${f.ident}${f.source}-on`} on={f.on_route} briefing={briefing} hazardKey={`field-${f.ident}-${f.source}`} />,
            ])}
          </ListGroup>
        )}
      {briefing && unchecked("hazards") !== unchecked("gairmets") && (
        <p className={cn("pt-2 text-caution-ink", TEXT.detail)}>
          {unchecked("hazards") ? "SIGMETs" : "G-AIRMETs"} could not be checked — verify separately before flight.
        </p>
      )}
    </AccordionSection>
  );
}

/** The route's winds and temperatures by stretch: consecutive legs that
 *  fly in the same forecast at the same altitude, one row each. The
 *  temperature is what the legs' true airspeeds are worked out from. */
function WindsAloft({ vm, legs }: { vm: FlightBriefing; legs: Leg[] }) {
  const { stretches } = vm;
  return (
    <AccordionSection title="Winds Aloft">
      {!stretches.some(st => st.wind) ? (
        <p>{legs.length ? "No winds-aloft data available for this route." : "Waiting on the nav log's legs…"}</p>
      ) : (
        // The forecast winds and temperatures each stretch of legs is
        // flown in, from the nearest winds-aloft station.
        <ListGroup>
          {stretches.map((st, i) => (
            <ListRow
              key={i}
              title={<span className="line-clamp-1">{st.from} → {st.to}</span>}
              description={`${altFt(st.altitudeFt)} ft`}
              value={`${st.wind ? `${windAloft(st.wind.dir, st.wind.speed)} kt` : "no wind data"}${st.oatC === null ? "" : ` · ${st.oatC} °C`}`}
            />
          ))}
        </ListGroup>
      )}
    </AccordionSection>
  );
}
