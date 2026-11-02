import { lazy, Suspense } from "react";
import { Mic } from "lucide-react";
import { cn } from "cn";
import IconButton from "./IconButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useAtcRadio } from "../lib/atcRadio";

const ClearanceCard = lazy(() => import("../features/plan/components/ClearanceCard"));

/**
 * The map's microphone, in the Stops button's place at the owner's ask
 * ("replace the stops button with a mic button", 2026-11-02): a tap opens
 * the Radio card -- Listen, the radio's log, and a clearance heard or
 * typed read into the route (ClearanceCard). In the tint and beating
 * while the radio is listened to, the captions over the map then
 * (RadioLayer); opened from the captions and a call's Enter Route too
 * (lib/atcRadio). Stops are the Airport tab's Find Nearby now.
 */
export default function RadioButton() {
  const open = useAtcRadio(s => s.cardOpen);
  const listening = useAtcRadio(s => s.listening);
  const setOpen = (cardOpen: boolean) => useAtcRadio.setState({ cardOpen });
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <IconButton
          label={listening ? "The radio, listening" : "Radio: hear ATC and read a clearance"}
          aria-pressed={listening} data-testid="radio-button"
          className={cn(listening && "animate-pulse text-tint")}
        >
          <Mic className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Radio" side="right" align="end" className="flex w-96 flex-col gap-3 p-3" data-testid="clearance-card">
        <Suspense fallback={<div className="h-40" aria-hidden="true" />}>
          <ClearanceCard onDone={() => setOpen(false)} />
        </Suspense>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
