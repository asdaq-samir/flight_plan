import { useState } from "react";
import SheetDialog from "./SheetDialog";
import { useFailedAction } from "../lib/problems";

/**
 * Something the pilot just did that did not work -- a share, a save, a
 * sign-in refused -- as iOS says it: an alert with OK (lib/problems
 * `showError`) in the middle of the screen from `md` up and, on a phone,
 * a sheet from the navigation bar's edge with its close, as the app asks
 * before an action (useConfirm, SheetDialog). Mounted once, beside the
 * toaster -- and drawn from the first failure on: a phone's drawer reads
 * the page's scroll as it is put in the page, which made the browser lay
 * the page out there, 39 ms of a phone's (4x) as the planner opened with
 * nothing to say (2026-10-10).
 */
export default function ErrorAlert() {
  const failed = useFailedAction(s => s.failed);
  // Kept once it has been, so it closes as it opened.
  const [needed, setNeeded] = useState(false);
  if (failed && !needed) setNeeded(true);
  if (!needed && !failed) return null;
  return (
    <SheetDialog
      open={!!failed} onOpenChange={open => { if (!open) useFailedAction.setState({ failed: null }); }}
      alert title={failed?.title} description={failed?.description} action={{ label: "OK" }} testId="error-alert"
    />
  );
}
