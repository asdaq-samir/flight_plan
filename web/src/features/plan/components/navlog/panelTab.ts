import { createContext } from "react";
import type { BriefingPart } from "../briefing/sections";

/** The planning panel's tabs (PanelTabs). */
export type PanelTab = Exclude<BriefingPart, "profile"> | "navlog";

/** Brings a tab up from inside another, scrolled to one of its sections
 *  by its title where one is named: the Brief's Go / No-Go rows open
 *  what each says, as an iOS row opens its detail. A module of its own,
 *  so PanelTabs' file keeps fast refresh. */
export const GoToTab = createContext<(tab: PanelTab, section?: string) => void>(() => {});
