import TickBox from "../../../../components/TickBox";
import FindingIcon from "../../../../components/FindingIcon";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import {
  CAUTION_FROM, HIGH_FROM, LEVEL_TONE, LEVEL_WORDS, SELF_CHECKS, riskLine, useRisk, type Assessment,
} from "../../../../lib/frat";
import { TEXT } from "../../../../lib/text";

/**
 * The briefing's Risk Assessment (lib/frat): the level and its points
 * first, then what the briefing, the nav log and the logbook raised,
 * then what only the pilot can say, ticked where it is so. Saved with
 * the flight.
 */
export default function RiskAssessment({ assessment }: { assessment: Assessment }) {
  const ticked = useRisk(s => s.ticked);
  const tick = useRisk(s => s.tick);
  const selfKeys = new Set(SELF_CHECKS.map(c => c.key));
  const raised = assessment.factors.filter(f => !selfKeys.has(f.key));
  const groups = [...new Set(SELF_CHECKS.map(c => c.group))];
  return (
    <div className="space-y-4">
      <div className={TEXT.prose}>
        <p className={cn("font-semibold", LEVEL_TONE[assessment.level])} data-testid="risk-level">{riskLine(assessment)}</p>
        <p>{LEVEL_WORDS[assessment.level]}</p>
      </div>
      <ListGroup title="From the briefing and your logbook">
        {raised.length === 0 ? (
          <ListRow title={<span className="text-muted-foreground">Nothing raised</span>} />
        ) : raised.map(f => (
          <ListRow
            key={f.key}
            media={<FindingIcon finding={f.stop || f.points >= HIGH_FROM ? "stop" : "caution"} />}
            title={f.label} description={f.why} value={f.stop ? "No-go" : `+${f.points}`}
            data-testid="risk-found"
          />
        ))}
      </ListGroup>
      {groups.map(group => (
        <ListGroup key={group} title={group}>
          {SELF_CHECKS.filter(c => c.group === group).map(c => (
            <ListRow
              key={c.key} role="checkbox" aria-checked={!!ticked[c.key]}
              onClick={() => tick(c.key, !ticked[c.key])}
              media={<TickBox on={!!ticked[c.key]} />}
              title={c.label} description={c.why} value={c.stop ? "No-go" : `+${c.points}`}
              data-testid={`risk-check-${c.key}`}
            />
          ))}
        </ListGroup>
      ))}
      <p className={cn("px-1 text-muted-foreground", TEXT.note)}>
        After the FAA Risk Management Handbook’s PAVE and IMSAFE (FAA-H-8083-2). Amber from {CAUTION_FROM} points and red
        from {HIGH_FROM} are the planner’s own guide, not a rule: the decision is yours as pilot in command (91.3, 91.103).
        Saved with the flight.
      </p>
    </div>
  );
}
