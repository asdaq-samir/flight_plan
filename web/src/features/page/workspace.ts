import type { ReactNode } from "react";
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
  /** The panel's second row, in sight at rest: the airplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** The panel's head all the way up, in place of the top row and the
   *  controls: the route's figures alone over its tabs, at the pilot's
   *  ask (MapPanel's `figures`). */
  figures?: ReactNode;
  /** Beside the route form, in sight at rest: the workspace's own few
   *  actions (save, the narrative and print; filter, undo and more). */
  actions?: ReactNode;
  console: ReactNode;
  /** Loads the route in the panel's form. */
  submit: () => void;
  /** A load in progress: the form's own button is disabled. */
  loading?: boolean;
  /** The panel at rest: a capsule with the route in it, or a search bar
   *  while there is none (PanelCapsule). */
  compact?: ReactNode;
  /** The route's own box in place of the page's route form, beside the
   *  actions: the planner's pills (RouteBox). */
  route?: ReactNode;
  /** The panel's top row with it out, in place of the route form and the
   *  actions: the search bar, while there is no route. */
  head?: ReactNode;
  /** The panel's body alone with it out -- no route form, actions or
   *  controls over it: an airport's card opened over a route,
   *  as a place in Maps takes the sheet from the directions. */
  alone?: boolean;
  /** The panel's body down to the sheet's own edge, over the home
   *  indicator (MapPanel's toEdge): an airport's card, its tiles and tabs
   *  at its foot. */
  toEdge?: boolean;
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
