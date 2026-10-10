import { cn } from "cn";
import AlertsBanner from "./AlertsBanner";
import ProblemBanner from "./ProblemBanner";

/**
 * The map's lines beside its buttons (MapControls), on their edge: the
 * top right under a panel at the bottom, the bottom right otherwise --
 * what is ahead of own ship in the air (AlertsBanner) first, then what
 * the app could not do (ProblemBanner). Each its own glass, eight apart;
 * the column takes no taps of its own.
 */
export default function MapBanners({ clearLeft = false }: {
  /** Clear of map buttons on the left as well (MapControlsLeft). */
  clearLeft?: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[1000] flex flex-col items-start gap-2 nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto",
        clearLeft ? "left-[calc(max(0.5rem,env(safe-area-inset-left))+3.25rem)]" : "left-[max(1rem,env(safe-area-inset-left))]",
      )}
    >
      <AlertsBanner />
      <ProblemBanner />
    </div>
  );
}
