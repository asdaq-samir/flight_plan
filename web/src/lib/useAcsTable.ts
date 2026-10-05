import { useEffect, useState } from "react";
import type { AcsTable } from "./checkride";

/** The FAA's own words for each ACS code (lib/acs.json, 150 KB), loaded
 *  with the page that wants them rather than with the app: the Checkride
 *  page's, and the mock oral's. */
export function useAcsTable(): AcsTable | null {
  const [table, setTable] = useState<AcsTable | null>(null);
  useEffect(() => {
    let live = true;
    void import("./acs.json").then(m => { if (live) setTable(m.default as AcsTable); });
    return () => { live = false; };
  }, []);
  return table;
}
