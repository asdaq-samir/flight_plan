import type { ReactNode } from "react";
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
  /** The •••'s name to a screen reader: "C81 to KDLH: more". */
  label: string;
  actions: RowAction[];
  testId?: string;
  children: ReactNode;
}) {
  const items = (Item: typeof DropdownMenuItem | typeof ContextMenuItem) => actions.map(a => (
    <Item key={a.label} onSelect={a.onSelect} variant={a.destructive ? "destructive" : "default"} data-testid={a.testId}>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <RoundButton label={label} data-testid={testId}>
                <Ellipsis className="size-5" aria-hidden="true" />
              </RoundButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">{items(DropdownMenuItem)}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">{items(ContextMenuItem)}</ContextMenuContent>
    </ContextMenu>
  );
}
