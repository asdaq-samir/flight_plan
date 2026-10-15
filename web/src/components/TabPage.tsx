import type { ReactNode } from "react";
import { cn } from "cn";

/** The room between a tab page's sections, 24 points: Airport's room, less
 *  the 8 its strip kept under it besides. */
export const TAB_PAGE_GAP = "gap-6";

/**
 * A tab's own page in the map's panel -- Airport's search, its Favorites
 * and Recents; Aircraft's; FPL's Saved; Setup's -- one shell for all of
 * them, at the owner's ask ("consistent look and feel for all tabs"):
 * each had its own, and they told apart on a switch (Aircraft's strip
 * three points under Airport's; sections 32 points apart on Airport, 20
 * on Aircraft and 16 on Setup; the Recents headed in a list's small
 * capitals under the Favorites' title).
 * The sides sixteen in, eight under the head's row -- or, with no head
 * (Setup's), its first section where the search bar starts -- and one gap
 * between its sections (TAB_PAGE_GAP), each a labelled one (PillSection)
 * whose heading is the same on every tab. There at once as its tab is
 * picked: a card that comes in over a tab is PanelCard.
 */
export default function TabPage({ testId, headless = false, scroll = true, children }: {
  testId?: string;
  /** No head's row over it (Setup's): it starts where the head would. */
  headless?: boolean;
  /** Scrolls on its own; not where it is the strip under a head that is
   *  all the tab shows (FPL's Saved strip with no route). */
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-tab-page="" data-testid={testId}
      className={cn(
        "flex flex-col px-4 pb-4 [scrollbar-width:none]", TAB_PAGE_GAP,
        scroll && "min-h-0 flex-1 overflow-y-auto",
        headless ? "pt-1" : "pt-2",
      )}
    >
      {children}
    </div>
  );
}
