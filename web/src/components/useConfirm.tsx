import { useState, type ReactNode } from "react";
import SheetDialog from "./SheetDialog";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  /** Red, for what cannot be walked back. */
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * Asking before an action, in the app rather than the browser: an alert
 * (SheetDialog) in the middle of the screen from `md` up, with Cancel,
 * and on a phone a sheet from the navigation bar's edge with the action
 * under the question and the app's close in its title row -- from the
 * bottom, by default, as iOS asks about something just tapped.
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
  const dialog = (
    <SheetDialog
      open={open} onOpenChange={setOpen} alert title={title} description={description}
      action={{ label: confirmLabel, destructive, onClick: () => { setOpen(false); onConfirm(); } }}
    />
  );
  return [() => setOpen(true), dialog];
}
