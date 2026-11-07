/** The map's words, in the page's Inter (GlMapShell's font-faces). */
export const GL_FONT = ["Inter"];

/** A tap's reach and order: a mark within a finger's half-width (a 44 pt
 *  target), a line within AirspaceLayer's TAP_PX; the route's airports
 *  before its checkpoints before anything on the chart under them. */
export const TAP = {
  mark: 22,
  line: 10,
  rank: { field: 0, checkpoint: 1, mark: 2, line: 5, area: 8 },
} as const;
