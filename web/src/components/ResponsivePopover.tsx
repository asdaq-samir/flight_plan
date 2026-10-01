import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "./ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import type { NavEdge } from "../lib/preferences";
import { TEXT } from "../lib/text";

/**
 * A popover from `md` up and, on a phone, a sheet from the header's
 * edge: shadcn's Popover and Drawer behind Popover's own API. A panel
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

export function ResponsivePopover({ children, open, onOpenChange }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const edge = useNavEdge();
  return (
    <OnPhone.Provider value={isMobile ? edge : null}>
      {isMobile
        ? <Drawer direction={edge} open={open} onOpenChange={onOpenChange}>{children}</Drawer>
        : <Popover open={open} onOpenChange={onOpenChange}>{children}</Popover>}
    </OnPhone.Provider>
  );
}

export function ResponsivePopoverTrigger(props: ComponentProps<typeof PopoverTrigger>) {
  return useContext(OnPhone) ? <DrawerTrigger {...props} /> : <PopoverTrigger {...props} />;
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
   *  iOS sheet puts it -- and then the title sits between the two. */
  leading?: ReactNode;
};

export function ResponsivePopoverContent({ title, description, titleHidden, action, leading, className, children, align, side, sideOffset, alignOffset, ...props }: ContentProps) {
  const edge = useContext(OnPhone);
  if (!edge) {
    return (
      <PopoverContent aria-label={title} className={className} align={align} side={side} sideOffset={sideOffset} alignOffset={alignOffset} {...props}>
        {action !== undefined && (
          <div className="flex min-h-8 items-center justify-between gap-2">
            {leading}
            <div className={cn("font-semibold", TEXT.row, leading && "flex-1 text-center")}>{title}</div>
            {action}
          </div>
        )}
        {children}
      </PopoverContent>
    );
  }
  return (
    // At most 85% of the screen's height, the title above and the
    // panel's own content scrolling under it, clear of the notch from
    // the top and the home indicator from the bottom. The popover's
    // width classes are left behind.
    <DrawerContent
      className={edge === "top"
        ? "pt-[env(safe-area-inset-top)] data-[vaul-drawer-direction=top]:max-h-[85dvh]"
        : "data-[vaul-drawer-direction=bottom]:max-h-[85dvh]"}
      {...props}
    >
      <DrawerHeader
        className={titleHidden ? "sr-only" : cn(
          "pb-2 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left group-data-[vaul-drawer-direction=top]/drawer-content:text-left",
          action !== undefined && "flex-row flex-wrap items-center justify-between",
        )}
      >
        {leading}
        {/* A sheet's title at the app's size for one (TEXT), with a
            control beside it or not: without one it was the stock 14. */}
        <DrawerTitle className={cn("font-semibold", TEXT.title, leading && "flex-1 text-center")}>{title}</DrawerTitle>
        {action}
        {description ? <DrawerDescription className={action !== undefined ? "basis-full" : undefined}>{description}</DrawerDescription> : null}
      </DrawerHeader>
      <div className={cn("min-h-0 overflow-y-auto px-4", edge === "top" ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))]", titleHidden && "pt-4")}>
        {children}
      </div>
    </DrawerContent>
  );
}
