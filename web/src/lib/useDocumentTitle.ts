import { useEffect } from "react";

/** Sets the browser tab's title -- nothing in this app did before
 *  this hook existed, so every page showed index.html's one static
 *  `<title>Route — pick checkpoints</title>` regardless of which of
 *  the (now five) pages was actually open. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
