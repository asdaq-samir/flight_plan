import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "./ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useIsMobile } from "../hooks/use-mobile";

/**
 * A popover from `md` up and, on a phone, a sheet up from the bottom
 * edge: shadcn's Popover and Drawer behind Popover's own API. A panel
 * that fits beside its button stays a popover; on a phone the same
 * panel was the height of the screen over the header (the map's
 * layers), 70% of it scrolling inside (the altitude's reasoning), or
 * running off its right edge (the aircraft form). From the bottom, as
 * iOS presents a sheet, where the header and the map's buttons are on
 * a phone: the screen's width, at most 85% of its height, its content
 * scrolling inside when it is long. For a while it was a dialog in the
 * middle of the screen; only signing in is that now.
 */
const OnPhone = createContext(false);

export function ResponsivePopover({ children, open, onOpenChange }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <OnPhone.Provider value={isMobile}>
      {isMobile
        ? <Drawer open={open} onOpenChange={onOpenChange}>{children}</Drawer>
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
};

export function ResponsivePopoverContent({ title, description, titleHidden, className, children, align, side, sideOffset, alignOffset, ...props }: ContentProps) {
  if (!useContext(OnPhone)) {
    return (
      <PopoverContent aria-label={title} className={className} align={align} side={side} sideOffset={sideOffset} alignOffset={alignOffset} {...props}>
        {children}
      </PopoverContent>
    );
  }
  return (
    // At most 85% of the screen's height, the title above and the
    // panel's own content scrolling under it, clear of the home
    // indicator. The popover's width classes are left behind.
    <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[85dvh]" {...props}>
      <DrawerHeader className={titleHidden ? "sr-only" : "pb-2 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left"}>
        <DrawerTitle>{title}</DrawerTitle>
        {description ? <DrawerDescription>{description}</DrawerDescription> : null}
      </DrawerHeader>
      <div className={`min-h-0 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]${titleHidden ? " pt-4" : ""}`}>{children}</div>
    </DrawerContent>
  );
}
