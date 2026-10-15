import { useState } from "react";
import { cn } from "cn";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./ui/sheet";
import { phoneSheet } from "./phoneSheet";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { TEXT } from "../lib/text";
import { useFailedAction } from "../lib/problems";

/**
 * Something the pilot just did that did not work -- a share, a save, a
 * sign-in refused -- as iOS says it: an alert with OK (lib/problems
 * `showError`), shadcn's AlertDialog in the middle of the screen from
 * `md` up and, on a phone, a sheet from the navigation bar's edge, as the
 * app asks before an action (useConfirm). Mounted once, beside the
 * toaster -- and drawn from the first failure on: a phone's drawer reads
 * the page's scroll as it is put in the page, which made the browser lay
 * the page out there, 39 ms of a phone's (4x) as the planner opened with
 * nothing to say (2026-10-10).
 */
export default function ErrorAlert() {
  const failed = useFailedAction(s => s.failed);
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  // Kept once it has been, so it closes as it opened.
  const [needed, setNeeded] = useState(false);
  if (failed && !needed) setNeeded(true);
  if (!needed && !failed) return null;
  const close = (open: boolean) => { if (!open) useFailedAction.setState({ failed: null }); };
  // With no words under the title, nothing describes it: said to Radix,
  // which otherwise warns of a missing description.
  const described = failed?.description ? {} : { "aria-describedby": undefined };
  if (onPhone) {
    return (
      <Sheet open={!!failed} onOpenChange={close}>
        <SheetContent side={edge} showCloseButton={false} className={phoneSheet(edge)} role="alertdialog" {...described} data-testid="error-alert">
          <SheetHeader className="text-center">
            <SheetTitle className={cn("font-semibold", TEXT.title)}>{failed?.title}</SheetTitle>
            {failed?.description && <SheetDescription className={TEXT.note}>{failed.description}</SheetDescription>}
          </SheetHeader>
          <SheetFooter className={edge === "top" ? undefined : "pb-[max(1rem,env(safe-area-inset-bottom))]"}>
            <SheetClose asChild><Button>OK</Button></SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <AlertDialog open={!!failed} onOpenChange={close}>
      <AlertDialogContent data-testid="error-alert" {...described}>
        <AlertDialogHeader>
          <AlertDialogTitle>{failed?.title}</AlertDialogTitle>
          {failed?.description && <AlertDialogDescription>{failed.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
