import { lazy, Suspense, useState } from "react";
import { FileText } from "lucide-react";
import { ListRow } from "../../../components/GroupedList";
import { ItemSeparator } from "../../../components/ui/item";
import type { Runway } from "../../../lib/api/types";
import { ChartRow, DiagramRow } from "./AirportDiagram";

const SketchViewer = lazy(() => import("./SketchViewer"));

/**
 * The FAA's own pages for a field -- its airport diagram and its Chart
 * Supplement page, the current editions' -- each a row that shows it in
 * the app, full screen to pinch in on (ChartRow), at the pilot's ask:
 * the diagram was the whole sheet in the tab, where a row like the
 * Chart Supplement's takes a line. A field the FAA draws no diagram for
 * (most small fields) has the row all the same, showing the card's own
 * sketch of its runways full screen (`sketch`), where it said there was
 * none; nothing where there is no sketch either.
 */
export function PublicationRows({ ident, diagram, diagramCycle, supplement, sketch }: {
  ident: string;
  diagram?: string | null;
  /** The cycle the planner draws the diagram's picture from. */
  diagramCycle?: string | null;
  supplement?: string | null;
  /** The field's runways and where it is, for its sketch where the FAA
   *  publishes no diagram. */
  sketch?: { runways: Runway[]; lat: number; lon: number } | null;
}) {
  const [sketchOpen, setSketchOpen] = useState(false);
  const published = !!diagram || !!diagramCycle;
  const sketched = !published && !!sketch;
  return (
    <>
      {diagramCycle ? (
        <DiagramRow media={<FileText className="size-5" />} ident={ident} cycle={diagramCycle} url={diagram} testId="airport-diagram" />
      ) : diagram ? (
        <ChartRow media={<FileText className="size-5" />} title="Airport diagram" url={diagram} airport={ident} testId="airport-diagram" />
      ) : sketched && (
        <ListRow
          media={<FileText className="size-5" />} title="Airport diagram" description="A sketch of the runways: the FAA publishes none"
          onClick={() => setSketchOpen(true)} data-testid="airport-diagram-sketch"
        />
      )}
      {supplement && (published || sketched) && <ItemSeparator className="my-0" />}
      {supplement && (
        <ChartRow media={<FileText className="size-5" />} title="Chart Supplement" url={supplement} airport={ident} testId="chart-supplement" />
      )}
      {sketchOpen && sketch && (
        <Suspense fallback={null}>
          <SketchViewer ident={ident} {...sketch} onClose={() => setSketchOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
