import { useRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { cn } from "cn";
import RoundButton from "./RoundButton";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

/** One of a row's actions: Share, Clear, Delete… */
export interface RowAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Red, for what cannot be walked back. */
  destructive?: boolean;
  /** It opens a question of its own (Delete's), which keeps the focus. */
  asks?: boolean;
  testId?: string;
}

/**
 * A list's row as Maps' Recents set one (the owner's screenshot,
 * 2026-10-28): the row itself (`children`, a ListRow or PageRow), at its
 * end •••, the stock DropdownMenu, with the row's actions, and the same
 * actions from a long press or a right click anywhere on it, the stock
 * ContextMenu, the row lifted white over the list while that menu is
 * open, as Maps lifts it.
 */
export default function RowMenu({ label, actions, testId, children }: {
  /** The •••'s name to a screen reader, "More for C81 to KDLH": not the row's own name first, which a search for the row by its name also found. */
  label: string;
  actions: RowAction[];
  testId?: string;
  children: ReactNode;
}) {
  // An action that asks (Delete) opens its question once the menu has
  // closed, the focus left to the question: opened as the item was
  // picked, the closing menu's own focus and dismiss handling crossed the
  // question's opening, which a desktop's Dialog took as a click away and
  // a phone's sheet never showed (flights.spec, CI on both, 2026-10-28).
  const pending = useRef<(() => void) | null>(null);
  const afterClose = (event: Event) => {
    const run = pending.current;
    if (!run) return;
    pending.current = null;
    event.preventDefault();
    // After the menu's own clean-up, not in it: opened from inside it, the
    // question came up under the menu's aria-hidden over the rest of the
    // page, there but out of reach to VoiceOver and to a search by role.
    setTimeout(run, 0);
  };
  // A press in a menu is the menu's own: portalled out of the sheet in the
  // page but inside it in React's tree, it went on up to the map sheet's
  // head, whose drag (useDetentDrag) took the finger, and a tap on Delete
  // on a phone left the menu open with Delete only focused (flights.spec,
  // half the runs on the phone project). As PhoneSheetContent stops its own.
  const ownPress = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const items = (Item: typeof DropdownMenuItem | typeof ContextMenuItem) => actions.map(a => (
    <Item key={a.label} onSelect={() => { if (a.asks) pending.current = a.onSelect; else a.onSelect(); }} variant={a.destructive ? "destructive" : "default"} data-testid={a.testId}>
      {a.icon} {a.label}
    </Item>
  ));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn(
          // No iOS callout over a long press: the menu is the row's own.
          "flex items-center gap-1 pr-2 transition-[background-color,box-shadow,transform] [-webkit-touch-callout:none]",
          "data-[state=open]:relative data-[state=open]:z-10 data-[state=open]:scale-[1.02] data-[state=open]:rounded-2xl data-[state=open]:bg-card data-[state=open]:shadow-xl",
        )}>
          <div className="min-w-0 flex-1">{children}</div>
          {/* Not modal: as a modal menu over the sheet, a pick on a phone
              was now and then left unanswered, the menu open with its item
              focused (flights.spec, one run in four), and Delete's question
              came up under its aria-hidden. Escape and a tap away still
              close it. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <RoundButton label={label} data-testid={testId}>
                <Ellipsis className="size-5" aria-hidden="true" />
              </RoundButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={afterClose} onPointerDown={ownPress}>{items(DropdownMenuItem)}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48" onCloseAutoFocus={afterClose} onPointerDown={ownPress}>{items(ContextMenuItem)}</ContextMenuContent>
    </ContextMenu>
  );
}
