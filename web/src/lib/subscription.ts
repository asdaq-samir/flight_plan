import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import type { PaidFeature, Subscription } from "./api/types";
import { capabilitiesQuery, pilotQuery } from "./queryClient";

/**
 * The subscription to the paid features, as the page shows it: the
 * written briefing, checkpoint descriptions, the mock oral and the
 * debrief. Planning and flying are free. The server keeps the one
 * entitlement and checks it on every paid call (SubscriptionService);
 * what the page knows of it is only for saying so where each paid
 * feature is (PaidPrompt), and for counting what is left of a month.
 */

/** The founding price, kept for life by those who join early (the
 *  business plan). The stores will say their own, in the pilot's money,
 *  once they sell it; these are the website's words until then. */
export const PRICE = { monthly: "$1 a month", yearly: "$10 a year" } as const;

/** The pilot's subscription. Fresh for a minute, as the pilot is: each
 *  paid feature's place reads it. Asked only signed in. */
export const subscriptionQuery = queryOptions({
  queryKey: ["subscription"], queryFn: () => api.subscription.get(), staleTime: 60_000, retry: false, meta: { silent: true },
});

/** What the page may say of the paid features now. */
export type Entitlement =
  | { kind: "loading" }
  /** Nobody can sign in here (one's own machine): all of it is open. */
  | { kind: "open" }
  | { kind: "signed-out" }
  /** The subscription could not be read: the server decides, and says
   *  so where it refuses. */
  | { kind: "unknown" }
  | { kind: "free"; subscription: Subscription }
  | { kind: "entitled"; subscription: Subscription };

/** The pilot's entitlement, from who is signed in and their subscription. */
export function entitlementOf(access: string | undefined, signedIn: boolean | undefined,
  subscription: Subscription | undefined, failed = false): Entitlement {
  if (access === "OPEN") return { kind: "open" };
  if (signedIn === undefined) return { kind: "loading" };
  if (!signedIn) return { kind: "signed-out" };
  if (failed) return { kind: "unknown" };
  if (!subscription) return { kind: "loading" };
  return subscription.entitled ? { kind: "entitled", subscription } : { kind: "free", subscription };
}

export function useEntitlement(): Entitlement {
  const access = useQuery(capabilitiesQuery).data?.access;
  const pilot = useQuery(pilotQuery);
  const signedIn = pilot.isPending ? undefined : !!pilot.data;
  const subscription = useQuery({ ...subscriptionQuery, enabled: !!pilot.data });
  return entitlementOf(access, signedIn, subscription.data, subscription.isError);
}

/** Whether a paid feature may be asked for now: open, theirs, or not
 *  known here -- the server's own check then answers. */
export const mayUse = (entitlement: Entitlement) =>
  entitlement.kind === "open" || entitlement.kind === "entitled" || entitlement.kind === "unknown";

/** "57 of 60 left this month", for a Claude-written feature; null where
 *  it is not counted (a developer's, a machine of one's own). */
export function usesLeft(entitlement: Entitlement, feature: PaidFeature): string | null {
  if (entitlement.kind !== "entitled" || entitlement.subscription.state === "COMPED") return null;
  const use = entitlement.subscription.uses.find(u => u.feature === feature);
  if (!use) return null;
  return `${Math.max(0, use.cap - use.used)} of ${use.cap} left this month`;
}

/** "Free until 10 November", "Paid until 11 October 2027" -- what the
 *  pilot has, in a few words, the day first as the app writes dates. */
export function standing(subscription: Subscription, now = new Date()): string {
  const day = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", timeZone: "UTC",
      ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
    });
  };
  switch (subscription.state) {
    case "TRIAL": return subscription.until ? `Free until ${day(subscription.until)}` : "Free month";
    case "SUBSCRIBED": return subscription.until ? `Paid until ${day(subscription.until)}` : "Subscribed";
    case "COMPED": return "Included";
    default: return subscription.trialAvailable ? "Not started" : "Ended";
  }
}
