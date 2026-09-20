import type { ReactNode, Ref } from "react";
import clsx from "clsx";
import { TableCell, TableRow } from "./ui/table";

/**
 * A clickable/keyboard-selectable row -- the nav log's waypoints on
 * Plan and the waypoint list's on Dev select the same way (click,
 * Enter, or Space), invert the same way when selected, and only differ
 * in whether they're muted while *not* selected (the nav log's
 * destination and checkpoints missing wind data are; Dev's endpoints
 * are). One component, so the two pages' lists stay the same list to
 * a reader who moves between them.
 */
export function SelectableRow({
  selected, mutedWhenUnselected = false, onSelect, scrollRef, children,
}: {
  selected: boolean;
  mutedWhenUnselected?: boolean;
  onSelect: () => void;
  /** Only the actually-selected row needs this -- see the callers'
   *  own scrollIntoView effects. */
  scrollRef?: Ref<HTMLTableRowElement>;
  children: ReactNode;
}) {
  return (
    <TableRow
      ref={scrollRef}
      onClick={onSelect}
      tabIndex={0}
      data-selected={selected || undefined}
      onKeyDown={e => {
        // The row's own keys, not a button's inside it (Dev's inline
        // rating buttons sit in the note row below, but a control in
        // this row must keep its own Space/Enter).
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        "cursor-pointer focus:outline-none",
        // Inverted (bg-foreground/text-background), not just a tint --
        // the same treatment shadcn's own Tooltip uses for "this one
        // thing stands apart," which a selected row is exactly. Skips
        // the hover/muted-text classes entirely while selected rather
        // than layering them underneath: both would fight the
        // inversion for the same background/text-color properties.
        selected
          ? "bg-foreground text-background hover:bg-foreground"
          : clsx(mutedWhenUnselected && "text-muted-foreground", "hover:bg-accent focus-visible:bg-accent"),
      )}
    >
      {children}
    </TableRow>
  );
}

/**
 * The plain-text or control row directly under a selectable row -- the
 * airport-name row under departure/destination, the editable note
 * under a checkpoint, the rating buttons under Dev's selected waypoint
 * -- are the same shape (a single cell spanning the table, inverted in
 * step with the row above it), just different content.
 */
export function NoteRow({ selected, colSpan, children }: { selected: boolean; colSpan: number; children: ReactNode }) {
  return (
    <TableRow className={clsx(selected && "bg-foreground text-background hover:bg-foreground")}>
      <TableCell
        className={clsx("py-1 pr-2 pl-4 text-left text-xs", !selected && "bg-muted/60 text-muted-foreground")}
        colSpan={colSpan}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}
