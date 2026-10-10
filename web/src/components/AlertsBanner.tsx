import { useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { GLASS } from "./mapChrome";
import { TEXT } from "../lib/text";
import { acknowledge, alertTitle, alertWhen, alertWhere, useAhead } from "../lib/map/ahead";

/** A warning's red and a caution's amber, as a cockpit's are. */
const INK = {
  warning: "text-destructive-ink",
  caution: "text-amber-700 dark:text-amber-300",
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
        <button
          type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="alerts-banner-title"
          className={cn("flex min-w-0 flex-1 flex-col justify-center self-stretch py-1 text-left outline-none focus-visible:underline", TEXT.detail)}
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
          {open && (
            <span className="mt-1 flex flex-col gap-1.5 text-foreground">
              {alerts.map(a => (
                <span key={a.id} className="block" data-alert-item={a.kind}>
                  {a !== first && <span className={cn("block font-semibold", INK[a.level])}>{alertTitle(a)}: {alertWhen(a)} · {alertWhere(a)}</span>}
                  <span className="block">{a.need}</span>
                </span>
              ))}
              {first && (failed || unavailable.length > 0) && <span className="block text-muted-foreground">{unread}.</span>}
              <span className="block text-muted-foreground">From the phone's GPS and the FAA's data: advisory, not a terrain or traffic warning system.</span>
            </span>
          )}
        </button>
        {alerts.length > 0 && (
          <Button
            type="button" size="sm" variant="ghost" className={cn("relative shrink-0 rounded-full text-tint after:absolute after:-inset-x-1 after:-inset-y-1.5", open && "self-start")}
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
