import { createContext } from "react";

/** Sections laid open, each its title over its content, rather than folded
 *  into an accordion (AccordionSection): the planning panel's tabs, which
 *  already show one part of the flight at a time, provide it. */
export const SectionsOpen = createContext(false);
