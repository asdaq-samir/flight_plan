import { lazy, Suspense, useEffect, useState } from "react";
import { onToastWanted } from "../lib/toast";

const AppToaster = lazy(() => import("./AppToaster"));

/** AppToaster, and sonner with it, off the first load: mounted when the
 *  browser is idle, or at once when a toast is first made (lib/toast).
 *  Safari has no requestIdleCallback, so a timer stands in. */
export default function ToasterHost() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const mount = () => setMounted(true);
    const off = onToastWanted(mount);
    const idle = typeof requestIdleCallback === "function"
      ? requestIdleCallback(mount, { timeout: 4000 })
      : null;
    const timer = idle === null ? window.setTimeout(mount, 2000) : null;
    return () => {
      off();
      if (idle !== null) cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
  return mounted ? <Suspense fallback={null}><AppToaster /></Suspense> : null;
}
