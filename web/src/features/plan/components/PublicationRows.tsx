import { FileText } from "lucide-react";
import { ListRow } from "../../../components/GroupedList";

/** The FAA's own pages for a field -- its airport diagram and its Chart
 *  Supplement page, the current editions' PDFs -- as rows that open
 *  them; none for a field that has neither (most small fields have no
 *  diagram). */
export function PublicationRows({ diagram, supplement }: { diagram?: string | null; supplement?: string | null }) {
  return (
    <>
      {diagram && (
        <ListRow media={<FileText className="size-5" />} title="Airport diagram" href={diagram} data-testid="airport-diagram" />
      )}
      {supplement && (
        <ListRow media={<FileText className="size-5" />} title="Chart Supplement" href={supplement} data-testid="chart-supplement" />
      )}
    </>
  );
}
