import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import PaidPrompt from "../../components/PaidPrompt";
import type { PaidFeature } from "../../lib/api/types";
import { PRICE, standing, subscriptionQuery } from "../../lib/subscription";
import { TEXT } from "../../lib/text";
import { FINDING_TONE } from "../../lib/status";

/** Each Claude-written feature's month, as the row names it. */
const COUNTED: Record<PaidFeature, string> = {
  NARRATIVE: "Written briefings",
  CHECKPOINT_NOTES: "Checkpoint descriptions",
  ORAL: "Mock-oral questions and grades",
  DEBRIEF: "Debriefs",
  HANDBOOK: "Handbook pages read",
};

const PLANS = { MONTHLY: "Monthly", YEARLY: "Yearly" } as const;
const STORES = { APP_STORE: "App Store", PLAY: "Google Play", WEB: "Website", GRANT: "Given" } as const;

/**
 * The Personal tab's Subscription page (PilotPanel): what the pilot has
 * -- the free month and until when, or the plan paid for -- and this
 * month's uses of each feature Claude writes against its allowance. With
 * none, the way to the free month (PaidPrompt). What stays free is said
 * once, under it all: planning and flying never need it.
 */
export default function SubscriptionPanel() {
  const { data: subscription, isPending, error } = useQuery(subscriptionQuery);
  if (isPending) return <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Checking your subscription…</p>;
  if (error || !subscription) {
    return <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)}>Your subscription could not be checked.</p>;
  }
  return (
    <div className="space-y-4" data-testid="subscription-panel">
      {/* What it is and costs, rows where they were a footnote: planning and
          flying are free; the subscription adds the written features. */}
      <ListGroup>
        <ListRow title="Status" value={standing(subscription)} data-testid="subscription-standing" />
        {subscription.plan && <ListRow title="Plan" value={PLANS[subscription.plan]} />}
        {subscription.store && <ListRow title="Bought on" value={STORES[subscription.store]} />}
        <ListRow title="Adds" description="The written briefing, checkpoint descriptions, the mock oral and the debrief" />
        <ListRow title="Price" value={`${PRICE.monthly} or ${PRICE.yearly}`} />
      </ListGroup>
      {subscription.entitled ? (
        subscription.state !== "COMPED" && (
          // Each written by Claude as it is asked for; the month starts again on the 1st.
          <ListGroup title="This Month">
            {subscription.uses.map(use => (
              <ListRow key={use.feature} title={COUNTED[use.feature]} value={`${use.used} of ${use.cap}`}
                data-testid={`subscription-use-${use.feature}`} />
            ))}
          </ListGroup>
        )
      ) : (
        <PaidPrompt feature="NARRATIVE" title="The Subscription">The flight told in plain words, a line for each checkpoint, a mock oral on your route, and your flown track measured against the plan.</PaidPrompt>
      )}
    </div>
  );
}
