import { useContext } from "react";
import { cn } from "cn";
import AccordionSection from "../../../../components/AccordionSection";
import FindingIcon from "../../../../components/FindingIcon";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { FINDING_TONE } from "../../../../lib/status";
import { TEXT } from "../../../../lib/text";
import { verdictLine, type VerdictItem } from "../../../../lib/verdict";
import { GoToTab } from "../navlog/panelTab";

/**
 * The Brief's first section (lib/verdict): what every tab found about the
 * flight, a row each with its mark, and what they come to over them. A
 * row opens the tab it was found in, at its section -- as an iOS row
 * with a chevron opens its detail -- so the go/no-go is read here and
 * checked there.
 */
export default function BriefVerdict({ items }: { items: VerdictItem[] }) {
  const go = useContext(GoToTab);
  const line = verdictLine(items);
  return (
    <AccordionSection title="Go / No-Go">
      <div className="space-y-3" data-testid="verdict">
        <p className={cn("flex items-start gap-2 font-semibold", FINDING_TONE[line.finding], TEXT.row)} data-testid="verdict-line" data-finding={line.finding} data-tip="verdict">
          <FindingIcon finding={line.finding} className="mt-0.5" />
          <span>{line.words}</span>
        </p>
        <ListGroup footer="Tap a finding to see it in full. The decision is yours as pilot in command (14 CFR 91.3).">
          {items.map(item => (
            <ListRow
              key={item.key} media={<FindingIcon finding={item.finding} />}
              title={item.label} description={<span className={cn(item.finding === "stop" && FINDING_TONE.stop)}>{item.detail}</span>}
              chevron onClick={() => go(item.tab, item.section)}
              data-testid={`verdict-${item.key}`} data-finding={item.finding}
            />
          ))}
        </ListGroup>
      </div>
    </AccordionSection>
  );
}
