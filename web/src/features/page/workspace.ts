import type { ReactNode } from "react";

/**
 * What a workspace (the pilot's planner, the developer's training)
 * hands the page to place: the map for the page's map area, the
 * drawer for its sidebar, the console for its top sheet, and the
 * action behind the header's own route form. The page (MapPage) owns
 * the shell -- the header, the sidebar, the console -- and the route
 * typed into it; a workspace owns everything about its own data.
 */
export interface WorkspacePieces {
  map: ReactNode;
  sidebar: ReactNode;
  console: ReactNode;
  /** Loads the route in the header's form. */
  submit: () => void;
  /** A load in progress: the form's own button is disabled. */
  loading?: boolean;
  /** Anything that sits under the header, over the map (a notice
   *  that the route has not been collected). */
  notices?: ReactNode;
}

export interface WorkspaceProps {
  /** The route in the header's form: the address's, or what the pilot
   *  has typed over it. */
  dep: string;
  dest: string;
  sidebarOpen: boolean;
  children: (pieces: WorkspacePieces) => ReactNode;
}
