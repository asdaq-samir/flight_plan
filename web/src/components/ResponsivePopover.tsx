import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useIsMobile } from "../hooks/use-mobile";

/**
 * A popover from `md` up and, on a phone, a dialog in the middle of the
 * screen: shadcn's Popover and Dialog behind Popover's own API. A panel
 * that fits beside its button stays a popover; on a phone the same
 * panel was the height of the screen over the header (the map's
 * layers), 70% of it scrolling inside (the altitude's reasoning), or
 * running off its right edge (the aircraft form). Centred, with a
 * margin all round and its content scrolling inside when it is long.
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
        ? <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
        : <Popover open={open} onOpenChange={onOpenChange}>{children}</Popover>}
    </OnPhone.Provider>
  );
}

export function ResponsivePopoverTrigger(props: ComponentProps<typeof PopoverTrigger>) {
  return useContext(OnPhone) ? <DialogTrigger {...props} /> : <PopoverTrigger {...props} />;
}

type ContentProps = ComponentProps<typeof PopoverContent> & {
  /** The dialog's heading on a phone -- and its accessible name either way. */
  title: string;
  /** Shown under the title on a phone; the popover has room for neither. */
  description?: string;
  /** For a panel whose content opens with its own heading: the dialog's
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
    // A 16px margin to the screen's edges, at most 85% of its height, the
    // title above and the panel's own content scrolling under it. The
    // popover's width classes are left behind.
    // A hidden title is out of the grid's flow, so then there is one row.
    <DialogContent
      className={titleHidden
        ? "max-h-[85dvh] w-[calc(100%-2rem)] grid-rows-[minmax(0,1fr)] p-4"
        : "max-h-[85dvh] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-3 p-4"}
      {...props}
    >
      <DialogHeader className={titleHidden ? "sr-only" : "pr-8 text-left"}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </DialogContent>
  );
}
