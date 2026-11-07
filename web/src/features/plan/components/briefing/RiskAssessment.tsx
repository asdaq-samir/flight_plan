import FindingIcon from "../../../../components/FindingIcon";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import {
  LEVEL_TONE, riskLine, selfChecks, useRisk, type Assessment,
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
  const checks = selfChecks();
  const selfKeys = new Set(checks.map(c => c.key));
  const raised = assessment.factors.filter(f => !selfKeys.has(f.key));
  const groups = [...new Set(checks.map(c => c.group))];
  return (
    <div className="space-y-4">
      <div className={TEXT.prose}>
        <p className={cn("font-semibold", LEVEL_TONE[assessment.level])} data-testid="risk-level">{riskLine(assessment)}</p>
        <p>{assessment.words}</p>
      </div>
      <ListGroup title="From the briefing and your logbook">
        {raised.length === 0 ? (
          <ListRow muted title="Nothing raised" />
        ) : raised.map(f => (
          <ListRow
            key={f.key}
            media={<FindingIcon finding={f.finding ?? "caution"} />}
            title={f.label} description={f.why} value={f.stop ? "No-go" : `+${f.points}`}
            data-testid="risk-found"
          />
        ))}
      </ListGroup>
      {groups.map(group => (
        <ListGroup key={group} title={group}>
          {checks.filter(c => c.group === group).map(c => (
            <ListRow
              key={c.key} checkbox={{ checked: !!ticked[c.key], onChange: on => tick(c.key, on) }}
              title={c.label} description={c.why} value={c.stop ? "No-go" : `+${c.points}`}
              data-testid={`risk-check-${c.key}`}
            />
          ))}
        </ListGroup>
      ))}
      {/* After the FAA Risk Management Handbook's PAVE and IMSAFE
          (FAA-H-8083-2): where it turns amber and red is the engine's
          (frat.rs), the planner's own guide, not a rule (91.3, 91.103). */}
    </div>
  );
}
