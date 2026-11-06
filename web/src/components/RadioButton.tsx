import { lazy, Suspense, useEffect } from "react";
import Waveform from "./Waveform";
import CommsGlyph from "./CommsGlyph";
import { cn } from "cn";
import IconButton from "./IconButton";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "./ResponsivePopover";
import { useAtcRadio } from "../lib/atcRadio";
import { canListen } from "../lib/listen";

const ClearanceCard = lazy(() => import("../features/plan/components/ClearanceCard"));

/** The listening code, fetched as the map is drawn so a tap starts it at
 *  once: Safari lets a page listen only straight from the tap. */
let listening: typeof import("../lib/atcListening") | null = null;
const load = () => import("../lib/atcListening").then(m => (listening = m));

/**
 * The map's microphone, in the Stops button's place at the owner's ask
 * (2026-11-02), and used as Siri's is at their pick (A, the same day): a
 * tap listens -- the mic's glyph becomes the waveform and its circle
 * widens into the pill beside it, the words typing in (RadioPill, in
 * MapControls) -- and a pause or a second tap ends it, the pill then
 * offering what can be done of what was heard. While the radio is
 * listened to on and on (the Radio card's Listen) a tap opens the card,
 * the log; where nothing can listen (Firefox), the card to type in.
 */
export default function RadioButton() {
  const open = useAtcRadio(s => s.cardOpen);
  const busy = useAtcRadio(s => s.listening);
  const mode = useAtcRadio(s => s.mode);
  const setOpen = (cardOpen: boolean) => useAtcRadio.setState({ cardOpen });
  useEffect(() => { void load(); }, []);
  const tap = () => {
    if (!canListen() || mode === "radio") {
      setOpen(true);
      return;
    }
    if (mode === "once") {
      listening?.stopRadio();
      return;
    }
    if (listening) void listening.listenOnce([]);
    else void load().then(m => m.listenOnce([]));
  };
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverAnchor asChild>
        <IconButton
          label={mode === "once" ? "Stop listening" : mode === "radio" ? "The radio, listening: open the log" : "Comms assist: listen"}
          aria-pressed={busy} data-testid="radio-button" onClick={tap}
          className={cn(busy && "text-tint", mode === "radio" && "animate-pulse")}
        >
          {/* Live: the input's level where one is metered (lib/audioInput). */}
          {mode === "once" && busy ? <Waveform live /> : <CommsGlyph />}
        </IconButton>
      </ResponsivePopoverAnchor>
      <ResponsivePopoverContent title="Radio" side="right" align="end" className="flex w-96 flex-col gap-3 p-3" data-testid="clearance-card">
        <Suspense fallback={<div className="h-40" aria-hidden="true" />}>
          <ClearanceCard onDone={() => setOpen(false)} />
        </Suspense>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
