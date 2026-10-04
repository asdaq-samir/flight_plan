import { useState, type KeyboardEvent } from "react";
import { Diamond, X } from "lucide-react";
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { InputGroup, InputGroupAddon } from "../../../components/ui/input-group";
import type { Detour } from "../../../lib/api/types";
import { MAX_STOPS, identSchema, stopSchema } from "../../../lib/identSchema";

/**
 * The route as ForeFlight's is: one box, every point of it a pill in the
 * order flown -- the departure, the airports landed at and the waypoints
 * flown through, the destination -- dragged into another order, tapped to
 * change, crossed out, and more typed after them ("VPBNG 06C", Enter) or
 * found with the plus. A point added goes in before the destination, as
 * a stop; from Fly via, on the flight the Class B stops (`via`), its
 * suggestions at the top of the picker. Every change re-plans at once,
 * so there is no Load button: the plus has its place at the box's end.
 * It was two airport fields and a Load button, with the stops as chips
 * in the row under them.
 *
 * The ends stay airports: a waypoint is flown through, never taken off
 * from or landed at, so a drag that would put one at an end is undone,
 * as is a route left with fewer than two points.
 */
export default function RouteBox({ points, waypoints, onChange, adding, onAddingChange, via }: {
  /** The departure, the stops, the destination. */
  points: string[];
  /** Which of them are waypoints, flown through: a diamond on the pill. */
  waypoints: Set<string>;
  onChange: (points: string[]) => void;
  /** The plus's picker open, from here or a problem's Add a stop. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** Fly via's waypoints round the Class B, best first. */
  via?: Detour[];
}) {
  const [typed, setTyped] = useState("");
  // Each point's key is its place in the order and its ident: the same
  // airport twice is two points.
  const ids = points.map((p, i) => `${i}:${p}`);
  // A press that moves is a drag; a tap is the pill's own (its picker).
  // On a finger, as on iOS, a drag starts with a hold.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const isEnd = (ident: string) => identSchema.safeParse(ident).success && !waypoints.has(ident);
  // No point straight after itself (KDLH, KDLH, KMDW) -- but a route
  // left as one airport twice is let through, to be said (PlanWorkspace's
  // notice) and changed in this box: taking the stop out of a round trip
  // did nothing at all.
  const repeats = (next: string[]) => next.some((p, i) => i > 0 && p === next[i - 1]);
  const valid = (next: string[]) => next.length >= 2 && isEnd(next[0]!) && isEnd(next.at(-1)!) && next.length - 2 <= MAX_STOPS
    && (!repeats(next) || next.length === 2);
  const change = (next: string[]) => { if (valid(next)) onChange(next); };

  // Where a new point goes: before the destination, as a stop -- or, from
  // Fly via, on the flight it is for.
  const at = via?.length ? via[0]!.stop_index + 1 : Math.max(points.length - 1, 0);
  const insert = (idents: string[]) => {
    const fresh = idents.map(i => stopSchema.safeParse(i).data).filter((i): i is string => !!i);
    if (!fresh.length) return;
    change([...points.slice(0, at), ...fresh, ...points.slice(at)]);
  };
  const commitTyped = () => {
    insert(typed.split(/[\s,]+/));
    setTyped("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === ",") {
      if (!typed.trim()) return;
      e.preventDefault();
      commitTyped();
    } else if (e.key === "Backspace" && !typed && points.length > 2) {
      // As a token field does: the last point before the destination goes.
      change([...points.slice(0, -2), points.at(-1)!]);
    }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    change(arrayMove(points, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    // The box's own presses are its pills', not the panel's drag.
    <form
      className="min-w-0" autoComplete="off" onPointerDown={e => e.stopPropagation()}
      onSubmit={e => { e.preventDefault(); if (typed.trim()) commitTyped(); }}
    >
      <InputGroup className="h-auto min-h-9 py-1 pl-1" data-testid="route-box">
        {/* One line that slides sideways under a finger, as ForeFlight's
            route does, where the pills wrapped onto a second and a third;
            the plus and the arrow stay put at its end. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="route-slide" data-slides="">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {points.map((point, i) => (
              <Pill
                key={ids[i]} id={ids[i]!} ident={point} waypoint={waypoints.has(point)} index={i}
                role={i === 0 ? "dep" : i === points.length - 1 ? "dest" : "stop"}
                removable={points.length > 2}
                onChange={ident => change(points.map((p, j) => (j === i ? ident : p)))}
                onRemove={() => change(points.filter((_, j) => j !== i))}
              />
            ))}
          </SortableContext>
        </DndContext>
        <input
          value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} onKeyDown={onKeyDown}
          onBlur={() => typed.trim() && commitTyped()}
          placeholder={points.length ? "" : "Route"} aria-label="Add to the route"
          enterKeyHint="done" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          // 16 at the least, as every field is: under 16 iOS zooms the
          // page in on it.
          className="w-16 min-w-16 flex-1 bg-transparent font-mono text-base uppercase outline-none md:text-sm pointer-coarse:text-[1.0625rem]"
          data-testid="route-type"
        />
        </div>
        {/* Inside the box's border: the stock addon pulls a button half
            out past it. */}
        <InputGroupAddon align="inline-end" className="mr-0 gap-1 pr-1.5 has-[>button]:mr-0">
          {points.length - 2 < MAX_STOPS && (
            <AirportPicker
              value="" placeholder="" ariaLabel="Add a stop" look="add" fixes
              // Where the Load button was, filled as it was.
              className="size-8 rounded-md bg-primary p-0 text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              open={adding} onOpenChange={onAddingChange} testId="add-stop"
              onChange={ident => insert([ident])}
              suggestions={via?.map(d => ({
                ident: d.ident, kind: d.kind,
                detail: [`+${Math.round(d.added_nm)} nm`, d.description].filter(Boolean).join(" · "),
              }))}
            />
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** One point of the route: its ident, a diamond for a waypoint, a tap to
 *  change it (the picker), a cross to take it out while more than two
 *  are left, and a drag to move it. */
function Pill({ id, ident, waypoint, index, role, removable, onChange, onRemove }: {
  id: string; ident: string; waypoint: boolean; index: number; role: "dep" | "stop" | "dest"; removable: boolean;
  onChange: (ident: string) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // The fields' own names, as the two fields were: "Departure", "Stop 1".
  const label = role === "dep" ? "Departure" : role === "dest" ? "Destination" : `Stop ${index}`;
  return (
    // A group, not dnd-kit's button: the picker and the cross inside it
    // are the buttons, and a button in a button is nothing a reader can
    // use (axe's nested-interactive). Still focusable, for the keyboard's
    // reordering (KeyboardSensor).
    <span
      ref={setNodeRef} {...attributes} {...listeners} role="group" aria-label={`${label} ${ident}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // A sideways swipe slides the line; a hold, then a move, drags.
        "inline-flex shrink-0 touch-pan-x items-center rounded-full bg-foreground/8 pr-0.5 select-none",
        isDragging && "z-10 shadow-md ring-2 ring-tint",
      )}
      data-testid={role === "stop" ? "stop" : `route-${role}`}
    >
      {waypoint && <Diamond className="ml-2 size-3 fill-[#b02e7c] stroke-[#b02e7c] dark:fill-[#e070b0] dark:stroke-[#e070b0]" aria-hidden="true" />}
      <AirportPicker
        value={ident} placeholder={label} ariaLabel={label} look="pill" fixes={role === "stop"}
        className={cn("h-8 rounded-full", waypoint ? "pl-1 pr-1.5" : "px-2")} onChange={onChange}
      />
      {removable && (
        <button
          type="button" onClick={onRemove} aria-label={role === "stop" ? `Remove the stop at ${ident}` : `Remove ${ident}`}
          className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}
