import { createContext } from "react";

/** Whether the tab holding a console's pages (ConsolePages) is up: Setup's,
 *  kept while another tab is (MapPage), goes back to its list as it is put
 *  away, as each tab starts on its own page. Up wherever nothing says
 *  otherwise. */
export const PagesShown = createContext(true);
