import { useEffect } from "react";

/** Sets the browser tab's title -- nothing in this app did before
 *  this hook existed, so every page showed index.html's one static
 *  `<title>Route — pick checkpoints</title>` regardless of which of
 *  the (now five) pages was actually open. `null` leaves whatever
 *  title is already set alone -- for a page component reused
 *  embedded inside another one (LabelView inside Settings' own Dev
 *  Label tab), where the URL is still the host page's own and its
 *  title should stay put, not flip to the embedded page's own title
 *  the instant that tab mounts. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}
