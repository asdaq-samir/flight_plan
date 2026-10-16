import { createContext, useContext } from "react";

/** The row a control is in, where it has a Delete behind it (SwipeToDelete):
 *  its Delete to bring out, as Edit's minus does (RemoveMinus). */
export const SwipeRow = createContext<{ reveal: () => void } | null>(null);

/** The swipe row round a control, if any. */
export const useSwipeRow = () => useContext(SwipeRow);
