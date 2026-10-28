import { createContext, useContext, type CSSProperties } from "react";

/** The row a control is in, where it has a Delete behind it (SwipeToDelete):
 *  its Delete to bring out, as Edit's minus does (RemoveMinus). */
export const SwipeRow = createContext<{ reveal: () => void } | null>(null);

/** A sortable list's row (Favorites' SortableRow): the box that moves,
 *  given to the row's own (SwipeToDelete's) rather than a box round it. */
export const SortItem = createContext<{ ref: (node: HTMLElement | null) => void; style: CSSProperties; className?: string } | null>(null);

/** The swipe row round a control, if any. */
export const useSwipeRow = () => useContext(SwipeRow);
