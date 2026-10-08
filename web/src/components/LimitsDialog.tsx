import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { LIMITS, useAcknowledged } from "../lib/limits";

/**
 * The words of lib/limits, once, the first time the app opens on a device
 * and until the pilot says "I understand": a stock dialog that only that
 * button closes, so it is acknowledged rather than dismissed by accident.
 */
export default function LimitsDialog() {
  const acknowledged = useAcknowledged(s => s.acknowledged);
  const acknowledge = useAcknowledged(s => s.acknowledge);
  return (
    <Dialog open={!acknowledged}>
      <DialogContent
        showCloseButton={false} data-testid="limits-dialog"
        onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Before you fly</DialogTitle>
          <DialogDescription>{LIMITS}</DialogDescription>
        </DialogHeader>
        <Button onClick={acknowledge} data-testid="limits-acknowledge">I understand</Button>
      </DialogContent>
    </Dialog>
  );
}
