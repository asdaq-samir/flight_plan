import { cn } from "cn";
import { ListRow } from "./GroupedList";
import { FINDING_TONE } from "../lib/status";
import { TEXT } from "../lib/text";

/** What a query says of itself (TanStack Query's own flags). */
interface Asked {
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

/**
 * A list's word while what it shows is asked for -- "Fetching the
 * squawks…" -- and, where it could not be had, that it could not, with
 * Try again, in place, as CLAUDE.md asks errors to be shown: one line for
 * every list, where the checklist, the squawks, the checkride's record and
 * Nearest stayed on "Fetching…" for good after a failure, the logbook said
 * it had no flights, and the saved flights showed nothing at all (the
 * commonality audit's N-12). A row of a list (`row`), else a line of its
 * own; nothing once the answer is in.
 */
export default function QueryState({ query, fetching, failed, row = false }: {
  query: Asked;
  /** While it is asked for: "Fetching the squawks…". */
  fetching: string;
  /** Where it could not be had: "The squawks could not be fetched." */
  failed: string;
  row?: boolean;
}) {
  if (query.isError && !query.isFetching) {
    const words = (
      <>
        {failed}{" "}
        <button
          type="button" onClick={() => void query.refetch()} data-testid="query-retry"
          className="relative text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      </>
    );
    return row
      ? <ListRow title={<span role="alert" className={cn(FINDING_TONE.stop, TEXT.detail)}>{words}</span>} />
      : <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.note)}>{words}</p>;
  }
  if (query.isLoading || query.isError) {
    return row
      ? <ListRow title={<span role="status" className={cn("text-muted-foreground", TEXT.detail)}>{fetching}</span>} />
      : <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>{fetching}</p>;
  }
  return null;
}
