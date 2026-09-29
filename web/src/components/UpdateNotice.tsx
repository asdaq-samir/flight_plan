import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAppUpdate } from "../lib/appUpdate";
import { Button } from "./ui/button";

/**
 * The offer of a new build, in two sizes. A toast when the build first
 * arrives -- what it is, Reload, Later -- and once that toast is put
 * away (Later, its close button, a swipe) a pill at the bottom of the
 * page that opens the toast again: an offer folded, not dropped. Gone
 * only when Reload takes it or the page is opened fresh.
 */
export default function UpdateNotice() {
  const { reload, minimized, minimize, expand, apply } = useAppUpdate();
  const offered = reload !== null && !minimized;

  useEffect(() => {
    if (!offered) return;
    toast("A new version of the planner is ready", {
      id: "app-update",
      duration: Infinity,
      description: "Reload for it now, or carry on; it stays offered below.",
      action: { label: "Reload", onClick: apply },
      cancel: { label: "Later", onClick: minimize },
      onDismiss: minimize,
    });
  }, [offered, apply, minimize]);

  if (reload === null || !minimized) return null;
  return (
    <Button
      variant="outline" size="sm"
      onClick={expand}
      aria-label="A new version of the planner is ready"
      data-testid="app-update-pill"
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 gap-1.5 shadow-md print:hidden"
    >
      <RefreshCw className="size-4" />
      New version
    </Button>
  );
}
