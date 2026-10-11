import { createContext } from "react";

/** Sections laid open, each its title over its content, rather than folded
 *  into an accordion (AccordionSection): the planning panel's tabs, which
 *  already show one thing at a time, provide it. */
export const SectionsOpen = createContext(false);

/** A tab's sections as tabs of their own (SectionTabs), at the pilot's
 *  ask: each section laid open registers itself, by its title, its
 *  element and the finding its title flags, if any (so its pill carries
 *  it while the section is out of sight), and shows only while it is the
 *  one picked (`shown`; null shows them all -- on paper, or a tab of one
 *  section). */
export interface SectionTabsApi {
  register: (title: string, el: HTMLElement, finding?: "stop" | "caution") => () => void;
  shown: string | null;
}
export const SectionTabsContext = createContext<SectionTabsApi | null>(null);
