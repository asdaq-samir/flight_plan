/** An airport diagram's picture: the planner draws the cycle's PDF once
 *  (its /api/airport-diagram), and the address, naming the cycle, is kept
 *  offline for the whole of it (vite.config.ts, airport-diagrams). The
 *  card shows it (PublicationRows), and a route kept for the air fetches
 *  its airports' (keepRoute). */
export const diagramPicture = (ident: string, cycle: string) =>
  `/api/planner/airport-diagram/${encodeURIComponent(cycle)}/${encodeURIComponent(ident)}.png`;
