import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "cn";
import { ListRow } from "../../../components/GroupedList";
import { ItemSeparator } from "../../../components/ui/item";
import { ChartRow, DiagramButton } from "./AirportDiagram";

/**
 * The FAA's own pages for a field -- its airport diagram and its Chart
 * Supplement page, the current editions' -- for a field that has them
 * (most small fields have no diagram). The diagram is shown as itself, at
 * the pilot's ask, the whole sheet in the card and a tap away from full
 * screen to pinch in on (DiagramButton), where it was a row that left the
 * app for the FAA's PDF; where the picture cannot be had, a row that
 * draws the PDF in the app instead. The Chart Supplement is a row that
 * shows its pages in the app too (ChartRow): nothing here leaves it.
 */
export function PublicationRows({ ident, diagram, diagramCycle, supplement }: {
  ident: string;
  diagram?: string | null;
  diagramCycle?: string | null;
  supplement?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const picture = !!diagramCycle && !failed;
  return (
    <>
      {picture ? (
        <DiagramButton
          ident={ident} cycle={diagramCycle} testId="airport-diagram-picture" onMissing={() => setFailed(true)}
          className={cn("block w-full", supplement ? "rounded-t-lg" : "rounded-lg")}
          // A whole sheet in the card's width at most, no taller than
          // most of a phone's half sheet.
          imageClassName="mx-auto block max-h-[22rem] w-auto max-w-full"
        />
      ) : diagram ? (
        <ChartRow media={<FileText className="size-5" />} title="Airport diagram" url={diagram} airport={ident} testId="airport-diagram" />
      ) : diagramCycle && (
        // The FAA lists a diagram (a cycle) but the picture would not load
        // and there is no PDF to fall back on: say so, not a blank tab.
        <ListRow title={<span className="text-muted-foreground">The airport diagram could not be loaded</span>} data-testid="airport-diagram-missing" />
      )}
      {supplement && <ItemSeparator className="my-0" />}
      {supplement && (
        <ChartRow media={<FileText className="size-5" />} title="Chart Supplement" url={supplement} airport={ident} testId="chart-supplement" />
      )}
    </>
  );
}
