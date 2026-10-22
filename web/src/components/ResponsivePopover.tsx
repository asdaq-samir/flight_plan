import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { Sheet, SheetClose, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import CloseButton from "./CloseButton";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import type { NavEdge } from "../lib/preferences";
import { PhoneSheetContent } from "./PhoneSheet";
import { TEXT } from "../lib/text";

/**
 * A popover from `md` up and, on a phone, a sheet from the header's
 * edge: shadcn's Popover and Sheet behind Popover's own API. A panel
 * that fits beside its button stays a popover; on a phone the same
 * panel was the height of the screen over the header (the map's
 * settings), 70% of it scrolling inside (the altitude's reasoning), or
 * running off its right edge (the aircraft form). From the edge the
 * header and the map's buttons are on (useNavEdge) -- by default the
 * bottom, as iOS presents a sheet: the screen's width, at most 85% of
 * its height, its content scrolling inside when it is long. For a while
 * it was a dialog in the middle of the screen; only signing in is that
 * now.
 */
/** The edge the sheet comes from on a phone; from `md` up, none. */
const OnPhone = createContext<NavEdge | null>(null);

export function ResponsivePopover({ children, open, onOpenChange, phoneEdge }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The edge a phone's sheet comes from, where it is not the navigation
   *  bar's: a search typed into comes from the top, clear of the
   *  keyboard, as Maps' search sheet stands. */
  phoneEdge?: NavEdge;
}) {
  const isMobile = useIsMobile();
  const navEdge = useNavEdge();
  const edge = phoneEdge ?? navEdge;
  return (
    <OnPhone.Provider value={isMobile ? edge : null}>
      {isMobile
        ? <Sheet open={open} onOpenChange={onOpenChange}>{children}</Sheet>
        : <Popover open={open} onOpenChange={onOpenChange}>{children}</Popover>}
    </OnPhone.Provider>
  );
}

export function ResponsivePopoverTrigger(props: ComponentProps<typeof PopoverTrigger>) {
  return useContext(OnPhone) ? <SheetTrigger {...props} /> : <PopoverTrigger {...props} />;
}

/** What the popover is placed against, where a trigger cannot be (a mark
 *  inside another button, the logbook's); a phone's sheet needs none. */
export function ResponsivePopoverAnchor({ children, ...props }: ComponentProps<typeof PopoverAnchor>) {
  return useContext(OnPhone) ? <>{children}</> : <PopoverAnchor {...props}>{children}</PopoverAnchor>;
}

type ContentProps = ComponentProps<typeof PopoverContent> & {
  /** The sheet's heading on a phone -- and its accessible name either way. */
  title: string;
  /** Shown under the title on a phone; the popover has room for neither. */
  description?: string;
  /** For a panel whose content opens with its own heading: the sheet's
   *  title is then for the screen reader only. */
  titleHidden?: boolean;
  /** A control at the top, at the end of the title's row (the settings'
   *  Dev-mode switch, a form's Add): given one, the popover shows its
   *  title too. */
  action?: ReactNode;
  /** A control at the start of the title's row -- a form's Cancel, as an
   *  iOS sheet puts it -- and then the title sits between the two. No
   *  Back: the close goes back, at the owner's ask ("remove the back
   *  buttons, because close button should behave as the back button",
   *  2026-10-22), where a Back stood on the left of every sheet. */
  leading?: ReactNode;
  /** The phone's sheet's own classes: a fixed height, say, where it is
   *  sized to its content otherwise. */
  sheetClassName?: string;
  /** The phone's sheet's overlay's: clear, where the map under it is
   *  what the sheet is for. */
  sheetOverlayClassName?: string;
  /** On a phone, the app's close (CloseButton) at the title row's end
   *  where nothing else is there (`action`, `leading`): every sheet with
   *  a way out besides a tap on the map under it, where the Map
   *  settings', the altitude's and the drills' sheets had none (the
   *  commonality audit's C-4). False where the sheet's own Done is it. */
  closeButton?: boolean;
};

export function ResponsivePopoverContent({
  title, description, titleHidden, action, leading: given, className, sheetClassName, sheetOverlayClassName, closeButton, children, align, side, sideOffset,
  alignOffset, collisionPadding, ...props
}: ContentProps) {
  const edge = useContext(OnPhone);
  if (!edge) {
    return (
      <PopoverContent
        // Eight off its trigger, past the trigger's hit area (index.css),
        // where the stock four laid the popover over it.
        aria-label={title} className={className} align={align} side={side} sideOffset={sideOffset ?? 8} alignOffset={alignOffset}
        collisionPadding={collisionPadding} {...props}
      >
        {action !== undefined && (
          <div className="flex min-h-8 items-center justify-between gap-2">
            {given}
            {/* A heading, as the phone's sheet's title is (Radix's), so a
                page pushed in the popover (the Procedures') is named
                alike on both. */}
            <div role="heading" aria-level={2} className={cn("font-semibold", TEXT.row, given && "flex-1 text-center")}>{title}</div>
            {action}
          </div>
        )}
        {children}
      </PopoverContent>
    );
  }
  const leading = given;
  const end = (closeButton ?? (action === undefined && !given))
    ? <SheetClose asChild><CloseButton data-testid="sheet-close" /></SheetClose>
    : action;
  return (
    // The floating sheet's look (PhoneSheetContent), at most 85% of the
    // screen's height, the title above and the panel's own content
    // scrolling under it; the title's row is what a swipe takes it away
    // by, with the grabber. The popover's width classes are left behind.
    <PhoneSheetContent edge={edge} className={sheetClassName} overlayClassName={sheetOverlayClassName} {...props}>
      <SheetHeader
        data-swipe-handle=""
        className={titleHidden ? "sr-only" : cn(
          "touch-none pb-2 text-left",
          edge === "bottom" && "pt-5",
          (end !== undefined || leading) && "flex-row flex-wrap items-center justify-between",
        )}
      >
        {leading}
        {/* A sheet's title at the app's size for one (TEXT), with a
            control beside it or not: without one it was the stock 14. */}
        <SheetTitle className={cn("font-semibold", TEXT.title, leading && "flex-1 text-center")}>{title}</SheetTitle>
        {end}
        {description ? <SheetDescription className={end !== undefined || leading ? "basis-full" : undefined}>{description}</SheetDescription> : null}
      </SheetHeader>
      {/* Clear of the grabber at its far edge, and of the home indicator
          the sheet floats eight points over. */}
      <div className={cn("min-h-0 overflow-y-auto px-4", edge === "top" ? "pb-5" : "pb-[max(1rem,calc(env(safe-area-inset-bottom)-0.5rem))]", titleHidden && "pt-5")}>
        {children}
      </div>
    </PhoneSheetContent>
  );
}
