import type { ReactNode } from "react";
import type { PageSettings } from "../../components/SettingsPanel";
import type { PanelState } from "../../components/mapChrome";

/**
 * What a workspace (the pilot's planner, the developer's training)
 * hands the page to place: the map, the panel's body, its actions and
 * its controls, the console for its sheet, its own part of the map's
 * settings, and the action behind the route form. The page (MapPage)
 * owns the shell -- the panel over the map, the console, the map's
 * buttons -- and the route typed into it; a workspace owns everything
 * about its own data.
 */
export interface WorkspacePieces {
  map: ReactNode;
  /** The panel's body: the nav log and the briefing, the training list. */
  sidebar: ReactNode;
  /** The panel's second row, in sight at rest: the aeroplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** Beside the route form, in sight at rest: the workspace's own few
   *  actions (save, the narrative and print; filter, undo and more). */
  actions?: ReactNode;
  console: ReactNode;
  /** What the page adds to the map's settings (SettingsPanel). */
  settings?: PageSettings;
  /** Loads the route in the panel's form. */
  submit: () => void;
  /** A load in progress: the form's own button is disabled. */
  loading?: boolean;
  /** Anything that belongs over the panel's body, in sight at rest (a
   *  notice that the route has not been collected). */
  notices?: ReactNode;
}

export interface WorkspaceProps {
  /** The route in the panel's form: the address's, or what the pilot
   *  has typed over it. */
  dep: string;
  dest: string;
  /** How far the panel is out (MapPanel), and the way to move it. */
  panel: PanelState;
  setPanel: (state: PanelState) => void;
  children: (pieces: WorkspacePieces) => ReactNode;
}
