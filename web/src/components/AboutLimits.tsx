import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ListGroup, ListRow } from "./GroupedList";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { TEXT } from "../lib/text";
import { DATA_SOURCES, LIMITS } from "../lib/limits";
import { chartQuery } from "../lib/queryClient";
import { useNavEdge } from "../hooks/use-nav-edge";

/** "09-03-2026", the chart server's cycle, as "3 Sep 2026". */
function editionOf(cycle: string): string {
  const [month, day, year] = cycle.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return Number.isNaN(date.getTime()) ? cycle : format(date, "d MMM yyyy");
}

/** Settings' About & limits: a row (rows carry no descriptions) that opens
 *  a sheet with the words of lib/limits, the data sources and the chart's
 *  edition -- in the About group (SettingsPanel), with its glyph. */
export default function AboutLimits({ media }: { media?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const edge = useNavEdge();
  const { data: chart } = useQuery(chartQuery);
  return (
    <>
      <ListRow media={media} title="About & limits" chevron onClick={() => setOpen(true)} data-testid="about-limits" />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={edge} className="max-h-[85dvh] overflow-y-auto" data-testid="about-limits-sheet">
          <SheetHeader>
            <SheetTitle>About & limits</SheetTitle>
            <SheetDescription className={TEXT.prose}>{LIMITS}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <ListGroup
              title="Data sources"
              footer={chart ? `Chart edition: ${editionOf(chart.chart_cycle)}.` : undefined}
            >
              {DATA_SOURCES.map(s => <ListRow key={s} title={s} />)}
            </ListGroup>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
