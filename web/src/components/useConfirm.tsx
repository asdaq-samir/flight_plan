import { useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";

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
 * just tapped (an action sheet, shadcn's Drawer).
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
    <Drawer direction={edge} open={open} onOpenChange={setOpen}>
      {/* An alert, as the AlertDialog is; Cancel takes the focus, as it
          does there, so a keyboard's Enter never confirms unasked. */}
      <DrawerContent
        role="alertdialog" onOpenAutoFocus={e => { e.preventDefault(); cancel.current?.focus(); }}
        className={edge === "top" ? "pt-[env(safe-area-inset-top)]" : undefined}
      >
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className={edge === "top" ? undefined : "pb-[max(1rem,env(safe-area-inset-bottom))]"}>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm}>{confirmLabel}</Button>
          <DrawerClose asChild><Button ref={cancel} variant="outline">Cancel</Button></DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
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
