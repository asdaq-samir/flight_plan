import { lazy, Suspense } from "react";
import { Mic } from "lucide-react";
import { cn } from "cn";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import type { RouteParts } from "./RouteBox";
import type { TypedProcedure } from "../../../lib/procedures";
import { useAtcRadio } from "../../../lib/atcRadio";

const ClearanceCard = lazy(() => import("./ClearanceCard"));

/**
 * The route box's microphone, as Maps' search field has one: a clearance
 * heard from the radio, or typed, read into its items and entered as the
 * route once the pilot has read it (ClearanceCard). Its glyph in the
 * field's grey, as iOS draws a search field's microphone, in the tint
 * and beating while the radio is listened to; its 44-point area its
 * pseudo-element's (CLAUDE.md). Opened from the captions and a call's
 * Enter Route too (lib/atcRadio).
 */
export default function ClearanceButton({ route, onEnter }: {
  route: RouteParts;
  /** The route the clearance gives, its SID and STAR, and the altitude to
   *  fly (the expected one, else the one to maintain). */
  onEnter: (route: RouteParts, typed: TypedProcedure[], altitudeFt: number | null) => void;
}) {
  const open = useAtcRadio(s => s.cardOpen);
  const listening = useAtcRadio(s => s.listening);
  const setOpen = (cardOpen: boolean) => useAtcRadio.setState({ cardOpen });
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <button
          type="button" aria-label={listening ? "The radio, listening" : "Listen to the radio"} data-testid="clearance-listen" data-slot="field-mic"
          onPointerDown={e => e.stopPropagation()}
          className={cn(
            "relative grid size-5 shrink-0 place-items-center rounded-full outline-none after:absolute after:-inset-3 after:content-[''] hover:text-tint focus-visible:ring-2 focus-visible:ring-ring",
            listening ? "animate-pulse text-tint" : "text-muted-foreground",
          )}
        >
          <Mic className="size-5" aria-hidden="true" />
        </button>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Radio" side="bottom" align="end" className="flex w-96 flex-col gap-3 p-3" data-testid="clearance-card">
        <Suspense fallback={<div className="h-40" aria-hidden="true" />}>
          <ClearanceCard route={route} onEnter={(...entered) => { onEnter(...entered); setOpen(false); }} />
        </Suspense>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
