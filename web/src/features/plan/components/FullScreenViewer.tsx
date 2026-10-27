import type { ReactNode } from "react";
import CloseButton from "../../../components/CloseButton";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../../../components/ui/dialog";
import { TEXT } from "../../../lib/text";
import { cn } from "cn";

/**
 * A full-screen dialog with its title and close under the status bar,
 * the one shell the FAA's charts (ChartViewer) and a field's runway
 * sketch (SketchViewer) open in, so the two read as one viewer. On a
 * file of its own, not the chart viewer's, so the sketch's chunk never
 * carries Leaflet.
 */
export default function FullScreenViewer({ title, testId, closeTestId, onClose, children }: {
  title: ReactNode;
  testId: string;
  closeTestId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined} glass={false} data-testid={testId}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        {/* Under the status bar, the close where every panel has it. */}
        <div className="flex shrink-0 items-center gap-4 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
          <DialogTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{title}</DialogTitle>
          <DialogClose asChild>
            <CloseButton data-testid={closeTestId} />
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
