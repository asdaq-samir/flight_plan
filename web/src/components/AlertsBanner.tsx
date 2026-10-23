import { useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { GLASS } from "./mapChrome";
import { TEXT } from "../lib/text";
import { acknowledge, alertTitle, alertWhen, alertWhere, useAhead } from "../lib/map/ahead";
import { useSpokenAlerts } from "../lib/map/speak";

/** A warning's red and a caution's amber, as a cockpit's are. */
const INK = {
  warning: "text-destructive-ink",
  caution: "text-caution-ink",
} as const;

/**
 * What is ahead of own ship in the air (lib/map/ahead), over the map
 * where the pilot looks, above the system's problems: the first thing
 * ahead -- a warning before a caution, then the soonest -- with when and
 * how far, and how many more; a tap on the words opens all of them with
 * what each asks (the rule's section with it), and OK puts them away
 * until each has gone from ahead and comes back. Nothing on the ground.
 * Where the planner cannot say, that is said, in its place: a sky with
 * no alerts must not read as a clear one.
 */
export default function AlertsBanner() {
  const ahead = useAhead();
  // Said aloud too, where the pilot has asked for it.
  useSpokenAlerts(ahead);
  const [open, setOpen] = useState(false);
  if (!ahead) return null;
  const { alerts, unavailable, failed } = ahead;
  if (!alerts.length && !failed && !unavailable.length) return null;
  const first = alerts[0];
  const level = first?.level ?? "caution";
  const Icon = level === "warning" ? TriangleAlert : CircleAlert;
  const unread = failed ? "No alerts ahead: the planner did not answer" : `Not read for alerts: ${unavailable.join(", ")}`;
  return (
    <div className={cn(GLASS, "pointer-events-auto w-fit max-w-full rounded-[22px]")} data-alerts-banner="">
      <Alert
        // A warning is said at once to a screen reader; a caution as it can.
        role={level === "warning" ? "alert" : "status"}
        className={cn(
          "flex min-h-11 gap-2 rounded-[22px] border-transparent bg-transparent py-1 pr-1 pl-3 *:[svg]:translate-y-0",
          // Opened, the sign by the first line rather than the middle.
          open ? "items-start *:[svg]:mt-[0.6rem]" : "items-center", INK[level],
        )}
      >
        <Icon className="shrink-0" />
        {/* The first alert, a tap opening the rest under it: Radix's
            disclosure (shadcn's Collapsible), so what opens is beside the
            button that opens it, not inside it, and a screen reader is
            told which it controls. */}
        <Collapsible open={open} onOpenChange={setOpen} className={cn("flex min-w-0 flex-1 flex-col self-stretch", TEXT.detail)}>
          <CollapsibleTrigger
            data-testid="alerts-banner-title"
            className="flex min-w-0 flex-1 flex-col justify-center py-1 text-left outline-none focus-visible:underline"
          >
            {first ? (
              <>
                <span className={cn("block max-w-full font-semibold", !open && "truncate")}>{alertTitle(first)}</span>
                {/* How many more on the second line, so the first's name is
                    whole on its own. */}
                <span className={cn("block max-w-full text-foreground", !open && "truncate")}>
                  {alertWhen(first)} · {alertWhere(first)}
                  {alerts.length > 1 && !open && <span className="font-semibold"> · {alerts.length - 1} more</span>}
                </span>
              </>
            ) : (
              <span className={cn("block max-w-full font-medium", !open && "truncate")}>{unread}</span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1.5 pb-1 text-foreground">
            {alerts.map(a => (
              <div key={a.id} data-alert-item={a.kind}>
                {a !== first && <p className={cn("font-semibold", INK[a.level])}>{alertTitle(a)}: {alertWhen(a)} · {alertWhere(a)}</p>}
                <p>{a.need}</p>
              </div>
            ))}
            {first && (failed || unavailable.length > 0) && <p className="text-muted-foreground">{unread}.</p>}

          </CollapsibleContent>
        </Collapsible>
        {alerts.length > 0 && (
          <Button
            type="button" size="sm" variant="ghost" className={cn("shrink-0 rounded-full text-tint", open && "self-start")}
            data-testid="alerts-acknowledge"
            onClick={() => { acknowledge(alerts.map(a => a.id)); setOpen(false); }}
          >
            OK
          </Button>
        )}
      </Alert>
    </div>
  );
}
