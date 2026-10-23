import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { describeError } from "../../../../lib/api/client";
import type { AlternateCheck } from "../../../../lib/api/types";
import { patched, useSearchParamsNow } from "../../../../lib/useSearchParamsNow";
import { ceilingAndVisibility } from "../../format";
import { useAlternate, type AlternateWhere } from "../../hooks/useAlternate";

function standing(check: AlternateCheck): string {
  return check.good === true
    ? `Meets ${check.minimums?.ceiling_ft}-${check.minimums?.visibility_sm}`
    : check.good === false ? "Under its minimums" : "Check it";
}

/**
 * Under IFR, the Weather tab's Alternate: whether the destination needs
 * one -- the "1-2-3" of 14 CFR 91.169(b), its approach and its TAF an hour
 * either side of the ETA -- the one filed, checked at the ETA there
 * against its alternate minimums (91.169(c)), and the nearest fields with
 * a TAF that will do, each filed with a tap. The fuel on to the one filed
 * is the nav log's (91.167(a)(2)).
 */
export default function AlternateSection(where: AlternateWhere) {
  const { filed, data, isPending, error } = useAlternate(where);
  const [, setParams] = useSearchParamsNow();
  const file = (ident: string | null) => setParams(prev => patched(prev, { alternate: ident }), { replace: true });
  return (
    <AccordionSection title="Alternate">
      <div className="space-y-4" data-testid="alternate">
        {!where.eta ? (
          <p className="text-muted-foreground">Checked once the nav log has an ETA.</p>
        ) : isPending ? (
          <p className="text-muted-foreground" role="status">Fetching the destination&apos;s forecast…</p>
        ) : error ? (
          <p className="text-destructive" role="alert">The alternate could not be checked: {describeError(error)}</p>
        ) : data && (
          <>
            <ListGroup title="Destination">
              <ListRow
                title={data.destination.required ? "An alternate is required" : "No alternate required"}
                description={data.destination.required
                  ? data.destination.reasons.join(" ")
                  : "An approach, and 2,000 ft and 3 sm an hour either side of the ETA (14 CFR 91.169(b))."}
                value={ceilingAndVisibility(data.destination.ceiling_ft, data.destination.visibility_sm)}
                data-testid="alternate-destination"
              />
              {/* Its TAF as sent, a row of its own as a METAR's is, where it was a footnote. */}
              <ListRow
                title={data.destination.taf
                  ? <span className="font-mono break-words">{data.destination.taf}</span>
                  : <span className="text-muted-foreground">No TAF for the destination</span>}
                data-testid="alternate-destination-taf"
              />
            </ListGroup>
            {data.alternate && (
              <ListGroup title="Filed">
                <ListRow
                  title={data.alternate.ident}
                  description={data.alternate.reasons.length ? data.alternate.reasons.join(" ")
                    : `${data.alternate.distance_nm} nm on; ${data.alternate.precision ? "an ILS" : "a nonprecision approach"}, its minimums at the ETA there (14 CFR 91.169(c)).`}
                  value={<span className={cn(data.alternate.good === false && "font-semibold text-destructive")}>{standing(data.alternate)}</span>}
                  data-testid="alternate-filed"
                />
                {data.alternate.taf && <ListRow title={<span className="font-mono break-words">{data.alternate.taf}</span>} />}
                {data.alternate.alternate_minimums_url && (
                  <ListRow title="Its alternate minimums" href={data.alternate.alternate_minimums_url} chevron />
                )}
                <ListRow title="Take it off" onClick={() => file(null)} data-testid="alternate-remove" />
              </ListGroup>
            )}
            {/* Fields with a TAF within 100 nm, at or above their alternate
                minimums at the ETA there: 600 ft and 2 sm with an ILS, 800 ft
                and 2 sm without (14 CFR 91.169(c)); those that publish their
                own after, for the pilot to check against them. */}
            <ListGroup title="Alternates that will do">
              {data.suggestions.length === 0 ? (
                <ListRow title="None found" description="File one you have checked yourself." />
              ) : data.suggestions.filter(s => s.ident !== filed).map(s => (
                <ListRow
                  key={s.ident} title={s.ident}
                  description={`${s.distance_nm} nm · ${s.precision ? "ILS" : "nonprecision"} · ${ceilingAndVisibility(s.ceiling_ft, s.visibility_sm)}`}
                  value={s.good ? "File" : "Check, file"} onClick={() => file(s.ident)} data-testid={`alternate-suggestion-${s.ident}`}
                />
              ))}
            </ListGroup>
            {/* The forecasts are the TAFs, their TEMPO and PROB groups counted. */}
          </>
        )}
      </div>
    </AccordionSection>
  );
}
