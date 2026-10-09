import type { ReactNode, Ref } from "react";
import { cn } from "cn";
import { TableCell, TableRow } from "./ui/table";
import { TEXT } from "../lib/text";

/**
 * A clickable/keyboard-selectable row of the nav log (click, Enter, or
 * Space), its figures grey under black headings and black once it is
 * selected, in italics for a leg missing wind data. Selected, it takes
 * the grey tint the training
 * drawer's waypoint rows take, as an iOS list's selection does, so the
 * two pages' lists select alike to a reader who moves between them; it
 * was inverted, black on a white page, as the training list was before
 * it.
 */
export function SelectableRow({
  selected, estimated = false, expands = false, onSelect, scrollRef, kind, children,
}: {
  selected: boolean;
  /** What the row is, as `data-kind`: the nav log's checkpoint, airport
   *  or top of climb or descent. */
  kind?: string;
  /** A leg worked out without its wind (or not in yet): in italics. */
  estimated?: boolean;
  /** Whether selecting the row opens a note row under it (the nav
   *  log's): `data-expanded` while it is open. The selected row is said
   *  to a reader as the current one (aria-current); aria-expanded is
   *  not a plain table row's to have (axe's aria-conditional-attr). */
  expands?: boolean;
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
      data-kind={kind}
      aria-current={selected || undefined}
      data-expanded={expands ? selected : undefined}
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
      className={cn(
        // A ring for the keyboard, inside the row so the table's own
        // border is not painted over; the tint alone was easy to miss.
        "cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        // The figures in grey under the headings' black, as the pilot
        // asked, and black under the hover and focus tint (grey on the
        // tint was 4.35:1, under WCAG's 4.5) and selected.
        "text-muted-foreground hover:text-foreground focus-visible:text-foreground",
        estimated && "italic",
        // active: what a finger gets, where there is no hover -- the row
        // answers the touch before the map and the note do. The training
        // list's own tints.
        "hover:bg-foreground/5 focus-visible:bg-foreground/5 active:bg-foreground/8",
        // Last, because `cn` resolves conflicting Tailwind classes in
        // favour of the last one: the muted text and the hover tint
        // above are simply overridden. No rule between it and the note
        // it opens, which is the same tint: one selected group, as the
        // training list's row and its rating buttons are.
        selected && "bg-foreground/8 text-foreground hover:bg-foreground/8 focus-visible:bg-foreground/8",
        selected && expands && "border-b-transparent",
      )}
    >
      {children}
    </TableRow>
  );
}

/**
 * The plain-text or control row directly under a selected row -- the
 * airport's name under departure/destination, the leg's figures and
 * the editable note under a checkpoint -- the same shape whatever it
 * holds (a single cell spanning the table, in the selection's tint with
 * the row above it, as the training list's rating buttons are under
 * theirs), just different content.
 */
export function NoteRow({ selected, colSpan, children }: { selected: boolean; colSpan: number; children: ReactNode }) {
  return (
    <TableRow className={cn(selected && "bg-foreground/8 hover:bg-foreground/8")}>
      <TableCell
        // bg-muted/20, not /60: muted text on the darker tint was 4.4:1,
        // a hair under WCAG's 4.5 for 12px type (and /40 was 4.46). On
        // the selection's tint, the training list's grey words: muted
        // on it is 3.9:1. To a finger at the rows' own 15 (lib/text.ts).
        className={cn("py-1 pr-2 pl-4 text-left pointer-coarse:py-2", TEXT.detail, selected ? "text-foreground/70" : "bg-muted/20 text-muted-foreground")}
        colSpan={colSpan}
      >
        {/* The row's width, wrapped in it, and none of its own (w-0
            min-w-full, and wrapping, where the stock cell does not). A
            cell spanning the table had its content's width for the
            table to meet: one checkpoint's leg line a wind figure longer
            than the last widened the columns, a name further up wrapped
            to a second line, and every row under it -- the one just
            tapped among them -- moved down 16 px on a phone. */}
        <div className="w-0 min-w-full whitespace-normal">{children}</div>
      </TableCell>
    </TableRow>
  );
}
