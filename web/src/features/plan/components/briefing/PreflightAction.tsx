import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import FindingIcon from "../../../../components/FindingIcon";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import TickBox from "../../../../components/TickBox";
import { PREFLIGHT_ITEMS, usePreflight, useTicked } from "../../../../lib/preflight";
import { FINDING_TONE, type Finding } from "../../../../lib/status";
import { TEXT } from "../../../../lib/text";

/**
 * Preflight action (14 CFR 91.103, lib/preflight), as a list the pilot
 * ticks: each thing the rule asks a pilot to know before the flight,
 * what the planner found for it, and the rule. Then what is not fetched
 * here -- NOTAMs and ATC delays, whose FAA feeds are for operators -- as
 * links to where a pilot gets them. The ticks are for this flight; a new
 * route or time starts the list again.
 */
export default function PreflightAction({ flight, found }: {
  /** The flight the ticks are for: its route and time. */
  flight: string;
  /** What the planner found for each item, by its key. */
  found: Record<string, { finding?: Finding; detail: string }>;
}) {
  const ticked = useTicked(flight);
  const tick = usePreflight(s => s.tick);
  const done = PREFLIGHT_ITEMS.filter(item => ticked[item.key]).length;
  const all = done === PREFLIGHT_ITEMS.length;
  return (
    <AccordionSection
      title="Preflight Action"
      aside={(
        <span className={cn("font-semibold", all ? FINDING_TONE.ok : "text-muted-foreground", TEXT.note)} data-testid="preflight-count">
          {all ? "All reviewed" : `${done} of ${PREFLIGHT_ITEMS.length} reviewed`}
        </span>
      )}
    >
      <div className="space-y-4">
        <ListGroup footer="What 14 CFR 91.103 asks a pilot in command to know before a flight. Tick each once you have.">
          {PREFLIGHT_ITEMS.map(item => {
            const what = found[item.key];
            return (
              <ListRow
                key={item.key} role="checkbox" aria-checked={!!ticked[item.key]}
                onClick={() => tick(flight, item.key, !ticked[item.key])}
                media={<TickBox on={!!ticked[item.key]} />}
                title={item.title}
                description={(
                  <>
                    {what && (
                      <span className="flex items-start gap-1.5">
                        {what.finding && <FindingIcon finding={what.finding} className="mt-px size-4" />}
                        <span className={cn(what.finding === "stop" && FINDING_TONE.stop)}>{what.detail}</span>
                      </span>
                    )}
                    <span className="block">{item.rule}</span>
                  </>
                )}
                data-testid={`preflight-${item.key}`}
              />
            );
          })}
        </ListGroup>
        <ListGroup title="Not fetched here" footer="The FAA’s NOTAM and flow-control feeds need operator credentials, so these open where a pilot reads them.">
          <ListRow title="NOTAMs" description="1800wxbrief.com" href="https://www.1800wxbrief.com" />
          <ListRow title="NOTAM search" description="notams.aim.faa.gov" href="https://notams.aim.faa.gov/notamSearch/" />
          <ListRow title="ATC delays" description="fly.faa.gov" href="https://www.fly.faa.gov" />
        </ListGroup>
      </div>
    </AccordionSection>
  );
}
