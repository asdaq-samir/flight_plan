import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { Slot } from "radix-ui";
import { cn } from "cn";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useIsMobile } from "../hooks/use-mobile";
import { SheetCard } from "./SheetCard";
import { TEXT } from "../lib/text";

/**
 * A popover from `md` up and, on a phone, a card in the map's panel
 * (SheetCard), behind Popover's own API. A panel that fits beside its
 * button stays a popover; on a phone it was a sheet of its own floating
 * over the panel -- the map's settings, the approaches, the fuel's
 * breakdown, an airplane's form -- and is a card in the panel now, as
 * Maps opens everything in its one sheet, at the owner's ask ("let's have
 * consistency and common code", 2026-10-27): the panel up half way for
 * it, its close going back to what was there.
 */
type OnPhoneCard = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The control that opens it, for the focus to go back to. */
  setTrigger: (node: HTMLElement | null) => void;
  trigger: () => HTMLElement | null;
  /** A search: the panel all the way up for it, as Maps' search is. */
  search: boolean;
};

/** The card's open state on a phone; from `md` up, none (Radix's). */
const OnPhone = createContext<OnPhoneCard | null>(null);

export function ResponsivePopover({ children, open, onOpenChange, phoneEdge }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** "top" for a search typed into, whose card comes all the way up, clear
   *  of the keyboard; else a card half way. */
  phoneEdge?: "top" | "bottom";
}) {
  const isMobile = useIsMobile();
  // Open as the caller says where it says (`open`), else its own, as
  // Radix's are.
  const [own, setOwn] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  if (!isMobile) return <Popover open={open} onOpenChange={onOpenChange}>{children}</Popover>;
  const phone: OnPhoneCard = {
    open: open ?? own,
    setOpen: next => { setOwn(next); onOpenChange?.(next); },
    setTrigger,
    trigger: () => trigger,
    search: phoneEdge === "top",
  };
  return <OnPhone.Provider value={phone}>{children}</OnPhone.Provider>;
}

export function ResponsivePopoverTrigger({ asChild, onClick, ...props }: ComponentProps<typeof PopoverTrigger>) {
  const phone = useContext(OnPhone);
  if (!phone) return <PopoverTrigger asChild={asChild} onClick={onClick} {...props} />;
  const Comp = asChild ? Slot.Root : "button";
  const { open, setOpen, setTrigger } = phone;
  return (
    <Comp
      type={asChild ? undefined : "button"} aria-expanded={open} data-state={open ? "open" : "closed"}
      {...props}
      ref={setTrigger}
      // The caller's first, which can keep it shut (preventDefault), as
      // Radix's trigger lets it.
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
    />
  );
}

/** What the popover is placed against, where a trigger cannot be (a mark
 *  inside another button, the logbook's); a phone's card needs none. */
export function ResponsivePopoverAnchor({ children, ...props }: ComponentProps<typeof PopoverAnchor>) {
  return useContext(OnPhone) ? <>{children}</> : <PopoverAnchor {...props}>{children}</PopoverAnchor>;
}

type ContentProps = ComponentProps<typeof PopoverContent> & {
  /** The card's name on a phone -- and its accessible name either way. */
  title: string;
  /** Shown under the name on a phone; the popover has room for neither. */
  description?: string;
  /** For a panel whose content opens with its own field and close (the
   *  airport search's): the card's name is then for the screen reader only. */
  titleHidden?: boolean;
  /** A control at the top, at the end of the name's row (a form's Save, a
   *  Done, a close of its own that goes back a page first): given one, the
   *  popover shows its title too. */
  action?: ReactNode;
  /** A control at the start of the name's row -- a form's Cancel, as an
   *  iOS sheet puts it -- and then the name sits between the two. No
   *  Back: the close goes back, at the owner's ask ("remove the back
   *  buttons, because close button should behave as the back button",
   *  2026-10-22). */
  leading?: ReactNode;
  /** On a phone, the app's close (CloseButton) at the name row's end where
   *  nothing else is there (`action`, `leading`). False where the card's
   *  own Done is it. */
  closeButton?: boolean;
};

export function ResponsivePopoverContent({
  title, description, titleHidden, action, leading, className, closeButton, children, align, side, sideOffset,
  alignOffset, collisionPadding, ...props
}: ContentProps) {
  const phone = useContext(OnPhone);
  if (!phone) {
    return (
      <PopoverContent
        // Eight off its trigger, past the trigger's hit area (index.css),
        // where the stock four laid the popover over it.
        aria-label={title} className={className} align={align} side={side} sideOffset={sideOffset ?? 8} alignOffset={alignOffset}
        collisionPadding={collisionPadding} {...props}
      >
        {action !== undefined && (
          <div className="flex min-h-8 items-center justify-between gap-2">
            {leading}
            {/* A heading, as the phone's card's name is, so a page pushed
                in the popover (the Procedures') is named alike on both. */}
            <div role="heading" aria-level={2} className={cn("font-semibold", TEXT.row, leading && "flex-1 text-center")}>{title}</div>
            {action}
          </div>
        )}
        {children}
      </PopoverContent>
    );
  }
  if (!phone.open) return null;
  // The popover's own sizes and its other Radix handlers are left behind:
  // the card is the panel's width, and no modal (nothing outside it to
  // dismiss it on).
  const { onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, "data-testid": testId } = props as typeof props & { "data-testid"?: string };
  return (
    <SheetCard
      title={title} titleHidden={titleHidden} description={description} leading={leading} action={action} closeButton={closeButton}
      onClose={() => phone.setOpen(false)} raise={phone.search ? "full" : "half"} testId={testId} returnFocus={phone.trigger}
      onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={onEscapeKeyDown}
    >
      {children}
    </SheetCard>
  );
}
