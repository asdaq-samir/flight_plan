import { useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Sheet, SheetClose, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./ui/sheet";
import { PhoneSheetContent } from "./PhoneSheet";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { TEXT } from "../lib/text";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  /** Red, for what cannot be walked back. */
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * Asking before an action, in the app rather than the browser: shadcn's
 * AlertDialog in the middle of the screen from `md` up, and on a phone
 * a sheet from the header's edge (useNavEdge) with the action over
 * Cancel -- from the bottom, by default, as iOS asks about something
 * just tapped (an action sheet, shadcn's Sheet).
 * `window.confirm` was what asked before -- the browser's own box,
 * unthemed, headed by the site's address, and in an iOS app's web view
 * nothing at all (it returns false unless the native host draws one),
 * so the action it guarded silently never ran.
 *
 * A hook rather than a wrapper around the trigger, because the triggers
 * are IconButtons, whose root is a Tooltip rather than an element a
 * dialog trigger could take over: call `ask` from the button, render
 * `dialog` anywhere beside it.
 */
export function useConfirm({ title, description, confirmLabel, destructive, onConfirm }: ConfirmOptions): [() => void, ReactNode] {
  const [open, setOpen] = useState(false);
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = () => { setOpen(false); onConfirm(); };
  const dialog = onPhone ? (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* An alert, as the AlertDialog is; Cancel takes the focus, as it
          does there, so a keyboard's Enter never confirms unasked. */}
      <PhoneSheetContent edge={edge} role="alertdialog" onOpenAutoFocus={e => { e.preventDefault(); cancel.current?.focus(); }}>
        {/* As iOS asks: the question 17 points and semibold, what it
            does 13 under it, the buttons at a button's 17 (TEXT). A swipe
            on it toward its edge is Cancel. */}
        <SheetHeader data-swipe-handle="" className={cn("touch-none text-center", edge === "bottom" && "pt-5")}>
          <SheetTitle className={cn("font-semibold", TEXT.title)}>{title}</SheetTitle>
          <SheetDescription className={TEXT.note}>{description}</SheetDescription>
        </SheetHeader>
        <SheetFooter className={edge === "top" ? "pb-5" : "pb-[max(1rem,calc(env(safe-area-inset-bottom)-0.5rem))]"}>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm}>{confirmLabel}</Button>
          <SheetClose asChild><Button ref={cancel} variant="outline">Cancel</Button></SheetClose>
        </SheetFooter>
      </PhoneSheetContent>
    </Sheet>
  ) : (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={confirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [() => setOpen(true), dialog];
}
