import { useRef, type ComponentType, type ReactNode } from "react";
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut } from "../../../components/ui/context-menu";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from "../../../components/ui/dropdown-menu";

/** The menu's own parts, a DropdownMenu's or a ContextMenu's (shadcn's,
 *  the same shape). */
export interface MenuKit {
  Item: ComponentType<{ onSelect?: (e: Event) => void; variant?: "default" | "destructive"; "data-testid"?: string; children?: ReactNode }>;
  Label: ComponentType<{ children?: ReactNode }>;
  Separator: ComponentType;
  Shortcut: ComponentType<{ className?: string; children?: ReactNode }>;
}

export const DROPDOWN: MenuKit = { Item: DropdownMenuItem, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut };
export const CONTEXT_MENU: MenuKit = { Item: ContextMenuItem, Label: ContextMenuLabel, Separator: ContextMenuSeparator, Shortcut: ContextMenuShortcut };

/**
 * A sheet, a dialog or a search opened from a menu's item once the menu has
 * closed and given the focus back to what opened it: opened while the menu
 * still held the focus, a desktop's popover lost it to the menu and took
 * that for a click outside it, and closed (the hold spec on the desktop
 * project); and with the focus back there as it opens, the sheet gives it
 * back there as it closes, where VoiceOver was left on the page (the
 * audit's). `keep`, the focus left where the opened thing puts it (the
 * route box's search, which takes it itself).
 */
export function useAfterMenu() {
  const pending = useRef<{ go: () => void; keep: boolean } | null>(null);
  return {
    later: (go: () => void, keep = false) => () => { pending.current = { go, keep }; },
    onCloseAutoFocus: (e: Event) => {
      const next = pending.current;
      if (!next) return;
      pending.current = null;
      if (next.keep) e.preventDefault();
      window.setTimeout(next.go);
    },
  };
}

