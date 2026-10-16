import { useMemo, useRef, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { TEXT } from "../lib/text";
import { useConfirm } from "./useConfirm";
import { SwipeRow } from "./swipeRow";

/**
 * A list's row with a Delete behind it that a swipe to the left uncovers,
 * as iOS's lists have (Mail's, Maps' Recents), at the pilot's ask. The row
 * and the button sit side by side in a scroller that snaps to one or the
 * other, so the swipe is the browser's own scrolling -- with an iPhone's
 * momentum and rubber band, and never a fight with the sheet's own drag
 * or the list's scroll up and down -- rather than gesture code of ours.
 * The Delete is a button named for what it removes, in the tab order
 * (focused, it scrolls into sight), so a keyboard and a screen reader
 * reach it too; and a long press or a right click offers it in a menu, as
 * Maps' long press on a recent does. Its rows are a grouped list's
 * (ListGroup), whose rounded corners the first and the last keep.
 */
export function SwipeToDelete({ label, onDelete, children }: {
  /** What it removes, said by a screen reader and the menu: "Remove KDLH from Recents". */
  label: string;
  onDelete: () => void;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cover = () => scroller.current?.scrollTo({ left: 0, behavior: "smooth" });
  // The Delete brought out by the row's minus in Edit (RemoveMinus), as
  // iOS's minus slides its row over: focused, it scrolls into sight, and
  // goes back under as the focus leaves it.
  const row = useMemo(() => ({ reveal: () => deleteButton.current?.focus() }), []);
  return (
    <SwipeRow.Provider value={row}>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          // Made to slide sideways, its Delete past its end: the iOS
          // audit's sideways-scroll rule passes over it (data-slides).
          ref={scroller} data-testid="swipe-row" data-slides=""
          // Over the group's gaps to the hairlines either side (ItemGroup
          // spaces its small rows 10 apart), the row's words kept where they
          // were, so the Delete is as tall as the row looks, as iOS's is.
          className="group/swipe flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] not-first:-mt-2.5 not-last:-mb-2.5 first:rounded-t-lg last:rounded-b-lg [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="w-full shrink-0 snap-start group-not-first/swipe:pt-2.5 group-not-last/swipe:pb-2.5"
            // A tap on a row whose Delete is out covers it again, as iOS's
            // does, rather than opening what the row opens.
            onClickCapture={event => {
              if ((scroller.current?.scrollLeft ?? 0) > 4) {
                event.preventDefault();
                event.stopPropagation();
                cover();
              }
            }}
          >
            {children}
          </div>
          <button
            ref={deleteButton} type="button" aria-label={label} onClick={onDelete} onBlur={cover} data-testid="swipe-delete"
            // The light theme's red in the dark too: the dark theme's
            // lighter one gave the white word 2.9:1 (the iOS audit's P15),
            // this one 4.8.
            className={cn(
              "w-20 shrink-0 snap-end bg-red-600 font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              TEXT.row,
            )}
          >
            Delete
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={onDelete} data-testid="swipe-menu-delete">
          <Trash2 />{label}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    </SwipeRow.Provider>
  );
}

/**
 * A list's Clear, at its heading's end (ListGroup's `action`), as iOS puts
 * one over its Recents: asked first, as iOS asks before what cannot be
 * walked back, the list being all of it. Its words grow with the text, not
 * its box; a pseudo-element makes the 44-point area round them.
 */
export function ClearList({ title, description, onClear, testId }: {
  /** The question asked: "Clear the Recents?". */
  title: string;
  description: string;
  onClear: () => void;
  testId?: string;
}) {
  const [ask, dialog] = useConfirm({ title, description, confirmLabel: "Clear", destructive: true, onConfirm: onClear });
  return (
    <>
      <Button
        type="button" variant="ghost" size="sm" onClick={ask} data-testid={testId}
        className={cn("relative h-auto px-1 py-0.5 font-normal text-tint after:absolute after:-inset-x-2 after:-inset-y-3", TEXT.row)}
      >
        Clear
      </Button>
      {dialog}
    </>
  );
}
