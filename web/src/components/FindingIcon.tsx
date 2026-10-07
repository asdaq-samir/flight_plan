import { CircleCheck, CircleHelp, Loader2, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { FINDING_TONE, type Finding } from "../lib/status";

const ICONS = { ok: CircleCheck, caution: TriangleAlert, stop: OctagonAlert, unknown: CircleHelp, pending: Loader2 };

/**
 * A check's finding as a mark (lib/status): a tick in green, a triangle in
 * amber, an octagon in red -- a stop sign's shape, so the two warnings
 * differ by more than colour -- a question in grey, a spinner while it
 * is worked out. Each tab's rows start with one, as the briefing's
 * warnings always have.
 */
export default function FindingIcon({ finding, className }: { finding: Finding; className?: string }) {
  const Icon = ICONS[finding];
  return <Icon className={cn("size-5 shrink-0", FINDING_TONE[finding], finding === "pending" && "animate-spin", className)} aria-hidden />;
}
