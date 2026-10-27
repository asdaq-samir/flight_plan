import { useRef, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Sheet, SheetClose, SheetTrigger } from "./ui/sheet";
import CloseButton from "./CloseButton";
import { PhoneSheetBody, PhoneSheetContent, PhoneSheetHeader } from "./PhoneSheet";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";

/** What the dialog is for: Delete, Set, Sign in. */
export interface SheetDialogAction {
  label: ReactNode;
  /** What it does; the dialog stays open until its caller closes it.
   *  Without it, and without a form, it only closes the dialog: OK. */
  onClick?: () => void;
  /** The id of the caller's form, which it then submits: Enter in a field
   *  does the same, though the button is in the title row. */
  form?: string;
  disabled?: boolean;
  /** Red, for what cannot be walked back. */
  destructive?: boolean;
  testId?: string;
}

/** The first thing to type in or press, where a sheet opens on its
 *  content rather than on its close: the address to sign in with. */
const FIRST = "input:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]";

/**
 * Every box that asks something of the pilot over the page -- confirm a
 * delete, set an altitude, sign in, say something failed -- one way: in
 * the middle of the screen from `md` up (shadcn's AlertDialog for an
 * alert, its Dialog otherwise) and, on a phone, the floating sheet
 * (PhoneSheetContent) from the navigation bar's edge, as iOS asks from
 * the bottom of the screen (the sheet consolidation, 2026-10-27, where
 * four of them stood in the middle of a phone and three more each made
 * the switch their own way).
 *
 * Its title row is an iOS sheet's: the title and the app's close
 * (CloseButton) at its end; or, for a form (`cancel`), Cancel at its
 * start and the form's action at its end, as an iOS form sheet has them.
 * Otherwise the action is under what it asks, the width of the sheet --
 * on a phone only where it does something: an OK that only closes is the
 * close's job there.
 */
export default function SheetDialog({
  open, onOpenChange, title, description, alert = false, cancel = false, action, more, trigger, size, testId,
  onOpenAutoFocus, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** An alert (role alertdialog): it waits for an answer, a tap beside it
   *  does not put it away from `md` up, and the way out takes the focus,
   *  so Enter never confirms unasked. */
  alert?: boolean;
  /** A form's Cancel, and the action beside the title on a phone. */
  cancel?: boolean;
  action?: SheetDialogAction;
  /** A further button: in the buttons' row from `md` up, under the
   *  content on a phone (an altitude's Reset). */
  more?: ReactNode;
  /** What opens it, where that is its own button (Sign in). */
  trigger?: ReactNode;
  /** The alert's width from `md` up: "sm" for a field or two. */
  size?: "default" | "sm";
  testId?: string;
  /** Where the focus goes as it opens, where that is not the default:
   *  the field to type a figure into. */
  onOpenAutoFocus?: (event: Event) => void;
  children?: ReactNode;
}) {
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const out = useRef<HTMLButtonElement>(null);
  // With no words under the title nothing describes it: said to Radix,
  // which otherwise warns of a missing description.
  const described = description ? {} : { "aria-describedby": undefined };
  const acts = !!action && (!!action.onClick || !!action.form);
  // A form's action, or a choice to make, is a button of its own; an OK
  // closes as the close does.
  const actionButton = (className?: string, small = false) => action && (
    <Button
      type={action.form ? "submit" : "button"} form={action.form} size={small ? "sm" : "default"}
      variant={action.destructive ? "destructive" : "default"} disabled={action.disabled}
      onClick={action.form ? undefined : action.onClick ?? (() => onOpenChange(false))}
      className={className} data-testid={action.testId}
    >
      {action.label}
    </Button>
  );
  const focus = (event: Event) => {
    if (onOpenAutoFocus) return onOpenAutoFocus(event);
    // An alert's way out, as an alert focuses its Cancel; anything else
    // its first field or button, not the close it opens with now.
    const first = alert ? out.current : (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-dialog-body] :is(${FIRST})`);
    if (!first) return;
    event.preventDefault();
    first.focus();
  };

  if (onPhone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        <PhoneSheetContent
          edge={edge} data-testid={testId} onOpenAutoFocus={focus} {...described}
          // Only an alert's: an undefined role would take Radix's "dialog" away.
          {...(alert ? { role: "alertdialog" } : {})}
        >
          <PhoneSheetHeader
            edge={edge} title={title} description={description}
            leading={cancel ? <SheetClose asChild><Button ref={out} type="button" variant="ghost" size="sm" className="-ml-2">Cancel</Button></SheetClose> : undefined}
            end={cancel ? actionButton("-mr-1", true) : <SheetClose asChild><CloseButton ref={out} data-testid="sheet-close" /></SheetClose>}
          />
          <PhoneSheetBody edge={edge} data-dialog-body="" className="grid gap-4">
            {children}
            {more}
            {!cancel && acts && actionButton()}
          </PhoneSheetBody>
        </PhoneSheetContent>
      </Sheet>
    );
  }

  if (alert) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
        <AlertDialogContent size={size} data-testid={testId} onOpenAutoFocus={onOpenAutoFocus} {...described}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <div data-dialog-body="" className="contents">{children}</div>
          <AlertDialogFooter>
            {more}
            {(cancel || acts) && <AlertDialogCancel>Cancel</AlertDialogCancel>}
            {actionButton()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent data-testid={testId} onOpenAutoFocus={focus} {...described}>
        <DialogHeader>
          {/* The close at the title row's end, as a phone's sheet has it. */}
          <div className="flex items-center gap-2">
            <DialogTitle className="min-w-0 flex-1">{title}</DialogTitle>
            {!cancel && <DialogClose asChild><CloseButton ref={out} className="-my-2 -mr-2" data-testid="dialog-close" /></DialogClose>}
          </div>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div data-dialog-body="" className="contents">{children}</div>
        {(more || cancel || action) && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {more}
            {cancel && <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>}
            {actionButton()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
