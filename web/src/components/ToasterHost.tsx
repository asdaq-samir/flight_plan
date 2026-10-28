import { type ComponentType, lazy, Suspense, useEffect, useState } from "react";
import { onToastWanted } from "../lib/toast";

// A chunk that will not load shows no toasts, and takes nothing else down:
// the import is caught so the failed render cannot unmount the page.
const AppToaster = lazy<ComponentType>(() => import("./AppToaster").catch(() => ({ default: () => null })));

/** AppToaster, and sonner with it, off the first load: mounted when a toast
 *  is first made (lib/toast). Not on idle: a tab left open across a deploy
 *  would find its chunk gone, and vite:preloadError (main.tsx) would reload
 *  the page under a pilot's half-filled form with no tap behind it. */
export default function ToasterHost() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => onToastWanted(() => setMounted(true)), []);
  return mounted ? <Suspense fallback={null}><AppToaster /></Suspense> : null;
}
