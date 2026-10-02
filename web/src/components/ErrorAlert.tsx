import { cn } from "cn";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "./ui/drawer";
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
 * toaster.
 */
export default function ErrorAlert() {
  const failed = useFailedAction(s => s.failed);
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const close = (open: boolean) => { if (!open) useFailedAction.setState({ failed: null }); };
  // With no words under the title, nothing describes it: said to Radix,
  // which otherwise warns of a missing description.
  const described = failed?.description ? {} : { "aria-describedby": undefined };
  if (onPhone) {
    return (
      <Drawer direction={edge} open={!!failed} onOpenChange={close}>
        <DrawerContent role="alertdialog" {...described} className={edge === "top" ? "pt-[env(safe-area-inset-top)]" : undefined} data-testid="error-alert">
          <DrawerHeader>
            <DrawerTitle className={cn("font-semibold", TEXT.title)}>{failed?.title}</DrawerTitle>
            {failed?.description && <DrawerDescription className={TEXT.note}>{failed.description}</DrawerDescription>}
          </DrawerHeader>
          <DrawerFooter className={edge === "top" ? undefined : "pb-[max(1rem,env(safe-area-inset-bottom))]"}>
            <DrawerClose asChild><Button>OK</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
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
