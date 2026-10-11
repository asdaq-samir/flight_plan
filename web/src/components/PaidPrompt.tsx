import { Suspense, lazy, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Gauge, MessageSquareText, Sparkles } from "lucide-react";
import { cn } from "cn";
import EmptyState from "./EmptyState";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { api, describeError } from "../lib/api/client";
import type { PaidFeature } from "../lib/api/types";
import { inNativeApp } from "../lib/native";
import { PRICE, subscriptionQuery, useEntitlement } from "../lib/subscription";
import { TEXT } from "../lib/text";

/** Only for a pilot signed out, so not in the planner's first load. */
const SignInModal = lazy(() => import("../features/pilot/SignInModal"));

const TITLES: Record<PaidFeature, string> = {
  NARRATIVE: "Written Briefing",
  CHECKPOINT_NOTES: "Checkpoint Descriptions",
  ORAL: "Mock Oral",
  DEBRIEF: "Debrief",
};

const ICONS: Record<PaidFeature, ReactNode> = {
  NARRATIVE: <MessageSquareText />,
  CHECKPOINT_NOTES: <Sparkles />,
  ORAL: <BookOpenCheck />,
  DEBRIEF: <Gauge />,
};

/**
 * A paid feature's own place, for a pilot without the subscription: what
 * it does, that it comes with the subscription, its price and the free
 * month, and the way to it -- shown where the feature is, as iOS shows
 * what is not here yet (ContentUnavailableView, EmptyState), never over
 * the planning (the pricing-and-paywall skill). Signed out, the way in is
 * signing in. On the website the free month starts here, once an
 * account; in the iOS and Android apps it is the store's own introductory
 * offer, which those apps do not sell yet. Nothing at all where the
 * pilot has it, or where nobody can sign in (one's own machine).
 */
export default function PaidPrompt({ feature, title, children, className }: {
  feature: PaidFeature;
  /** Its heading where it speaks for more than the one feature. */
  title?: string;
  /** What it does, a sentence. */
  children: ReactNode;
  className?: string;
}) {
  const entitlement = useEntitlement();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => api.subscription.startTrial(),
    onSuccess: subscription => queryClient.setQueryData(subscriptionQuery.queryKey, subscription),
    // Said here, under its button.
    meta: { silent: true },
  });
  if (entitlement.kind !== "signed-out" && entitlement.kind !== "free") return null;
  const native = inNativeApp();
  const trial = entitlement.kind === "signed-out" || entitlement.subscription.trialAvailable;
  const action = entitlement.kind === "signed-out" ? <Suspense fallback={null}><SignInModal /></Suspense>
    : trial && !native ? (
      <div className="flex flex-col items-center gap-2">
        <Button onClick={() => start.mutate()} disabled={start.isPending} data-testid="start-trial">
          {start.isPending && <Spinner />}Start Free Month
        </Button>
        {start.isError && <p role="alert" className={cn("text-destructive", TEXT.note)}>{describeError(start.error)}</p>}
      </div>
    )
      : <p className={cn("text-muted-foreground", TEXT.note)}>{native ? "Subscribing in the app is coming." : "Subscribing is coming."}</p>;
  return (
    <div data-testid={`paid-prompt-${feature}`} className={className}>
      <EmptyState icon={ICONS[feature]} title={title ?? TITLES[feature]} action={action} className="p-4">
        {children}{" "}
        {trial
          ? `It comes with the subscription, ${PRICE.monthly} or ${PRICE.yearly}, the first month free.`
          : `It comes with the subscription, ${PRICE.monthly} or ${PRICE.yearly}.`}
        {entitlement.kind === "signed-out" && " Sign in to start."}
      </EmptyState>
    </div>
  );
}
