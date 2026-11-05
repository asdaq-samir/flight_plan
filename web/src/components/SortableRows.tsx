import { createContext, useContext, useMemo, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DraggableAttributes, type DraggableSyntheticListeners } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { SortItem } from "./swipeRow";
import IconButton from "./IconButton";

// Apart from Favorites' strips and tiles, which the first load draws:
// dnd-kit (about 48 KB) comes with the lists in full that a pilot edits,
// loaded when one is opened (FavoritesList, AircraftFavoritesList), and the
// first load back under CI's budget (scripts/first-load.mjs, 2026-11-05).

/** The rows a list's handles drag: dnd-kit's sortable (as the route's
 *  stops are, RouteBox), round the ListGroup that draws them, each row a
 *  `SortableRow` -- a drag by the handle, the list making room under it,
 *  VoiceOver told where it is, and the move made once, at the drop. */
export function SortableRows({ ids, onMove, children }: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors} collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(`${active.id}`), to = ids.indexOf(`${over.id}`);
        if (from >= 0 && to >= 0) onMove(from, to);
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  );
}

const SortHandle = createContext<{
  ref: (node: HTMLElement | null) => void; attributes: DraggableAttributes; listeners: DraggableSyntheticListeners;
} | null>(null);

/** One of a `SortableRows`' rows, lifted over the others while dragged. */
export function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  // The row's own box is what moves (SwipeToDelete's, by SortItem), not a
  // box round it: wrapped, each row was the first and the last of its own,
  // and lost the reach over the group's gaps that a list's rows have, a
  // band above and below every Favorite that a tap did nothing on (the
  // owner's screenshot, 2026-10-28).
  const item = useMemo(() => ({
    ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition },
    className: cn(isDragging && "relative z-10 bg-card shadow-lg"),
  }), [setNodeRef, transform, transition, isDragging]);
  return (
    <SortItem.Provider value={item}>
      <SortHandle.Provider value={{ ref: setActivatorNodeRef, attributes, listeners }}>{children}</SortHandle.Provider>
    </SortItem.Provider>
  );
}

/** The handle after a row being edited, in a `SortableRow`: dragged, its
 *  row goes with it (dnd-kit); and the arrow keys a place at a time, as
 *  they did, besides dnd-kit's own Space to lift and drop. */
export function MoveHandle({ label, index, count, onMove }: {
  label: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const sort = useContext(SortHandle);
  return (
    <IconButton
      label={label} className="touch-none"
      {...sort?.attributes} {...sort?.listeners} ref={sort?.ref}
      onKeyDown={e => {
        if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); onMove(index, index - 1); return; }
        if (e.key === "ArrowDown" && index < count - 1) { e.preventDefault(); onMove(index, index + 1); return; }
        sort?.listeners?.onKeyDown?.(e);
      }}
    >
      <GripVertical className="size-5 text-muted-foreground" />
    </IconButton>
  );
}
