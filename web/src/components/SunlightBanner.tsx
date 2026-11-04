import { Sun } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { TEXT } from "../lib/text";
import { unseen, useTips } from "../lib/tips";
import { usePreferences } from "../lib/preferences";
import { useSunlight, useSunlightSensor } from "../lib/sunlight";

/** The tips store's key for the banner, said once on this device. */
const SEEN = "sunlight-banner";

/**
 * The sunlight scheme's one line, the first time it comes on by itself
 * from the light sensor (lib/sunlight): black, as the owner's canvas
 * draws it over the white chart, with Keep off -- the setting to Off in
 * one tap -- and the app's close, either of which keeps it from coming
 * back. Mounted with the map's banners (MapBanners); it runs the scheme
 * itself (useSunlight) so the attribute is kept whatever is shown.
 */
export default function SunlightBanner() {
  useSunlight();
  const chartLight = usePreferences(s => s.chartLight);
  const setChartLight = usePreferences(s => s.setChartLight);
  const bright = useSunlightSensor(s => s.bright);
  const seen = useTips(s => s.seen);
  const see = useTips(s => s.see);
  if (chartLight !== "auto" || !bright || !unseen(seen, SEEN)) return null;
  return (
    <div
      role="status" data-testid="sunlight-banner"
      className={cn("pointer-events-auto flex min-h-11 w-fit max-w-full items-center gap-2 rounded-xl bg-black py-1 pr-1 pl-3 text-white", TEXT.detail)}
    >
      <Sun className="size-5 shrink-0 text-[#ffd60a]" strokeWidth={2.5} aria-hidden />
      <span className="min-w-0 flex-1">Bright light: high-contrast chart on.</span>
      <Button
        type="button" size="sm" variant="ghost" className="shrink-0 rounded-full font-semibold text-[#ffd60a] hover:bg-white/10 hover:text-[#ffd60a]"
        onClick={() => { setChartLight("off"); see(SEEN); }} data-testid="sunlight-keep-off"
      >
        Keep off
      </Button>
      <Button
        type="button" size="sm" variant="ghost" className="shrink-0 rounded-full text-white hover:bg-white/10 hover:text-white"
        onClick={() => see(SEEN)} aria-label="Close" data-testid="sunlight-banner-close"
      >
        OK
      </Button>
    </div>
  );
}
