/** An airport diagram's picture: the planner draws the cycle's PDF once
 *  (its /api/airport-diagram), and the address, naming the cycle, is kept
 *  offline for the whole of it (vite.config.ts, airport-diagrams). The
 *  card shows it (PublicationRows), and a route kept for the air fetches
 *  its airports' (keepRoute). */
export const diagramPicture = (ident: string, cycle: string) =>
  `/api/planner/airport-diagram/${encodeURIComponent(cycle)}/${encodeURIComponent(ident)}.png`;

/** A page of one of the FAA's charts, as the planner draws it
 *  (/api/faa-chart/page): its edition in its address, so kept offline for
 *  the whole of it too. */
export const chartPagePicture = (page: { source: string; edition: string; pdf: string; page: number }) =>
  `/api/planner/faa-chart/page/${encodeURIComponent(page.source)}/${encodeURIComponent(page.edition)}/${encodeURIComponent(page.pdf)}/${page.page}.png`;
