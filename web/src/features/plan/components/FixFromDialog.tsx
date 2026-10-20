import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../../components/ui/input-group";
import { frdIdent } from "../../../lib/identSchema";

/**
 * The pilot's own point off a point of the route, from its menu's "Create
 * a fix from here…", at the owner's ask ("30 miles 090 radial of vpbng",
 * "a fix should get its own row"): its magnetic course from there -- a
 * VOR's radial -- and how far, as a flight plan writes a fix/radial/
 * distance (FAA Form 7233-4), and the route flies over it next. Asked as
 * iOS asks for a figure or two: an alert with its fields.
 */
export default function FixFromDialog({ from, onClose, onCreate }: {
  /** The point it is measured from; null, put away. */
  from: string | null;
  onClose: () => void;
  onCreate: (ident: string) => void;
}) {
  return (
    <AlertDialog open={!!from} onOpenChange={open => { if (!open) onClose(); }}>
      <AlertDialogContent
        size="sm"
        onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
      >
        {from && <FixFromForm key={from} from={from} onCreate={onCreate} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FixFromForm({ from, onCreate }: { from: string; onCreate: (ident: string) => void }) {
  const [course, setCourse] = useState("");
  const [distance, setDistance] = useState("");
  const deg = course.length === 3 ? Number(course) : NaN;
  const nm = Number(distance);
  // A course of 001 to 360 (000 is 360), out to 999 nm, as the planner
  // takes one (vfr.fixes.parse_frd).
  const valid = deg >= 0 && deg <= 360 && nm > 0 && nm <= 999;
  const ident = valid ? frdIdent(from, deg, nm) : null;
  const create = () => { if (ident) onCreate(ident); };
  return (
    <form onSubmit={e => { e.preventDefault(); create(); }} className="contents">
      <AlertDialogHeader>
        <AlertDialogTitle>A fix from {from}</AlertDialogTitle>
        <AlertDialogDescription>
          Its magnetic course from {from}, a VOR's radial, and how far. Flown over next{ident ? `: ${ident}` : "."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex gap-2">
        {/* Each figure with its unit inside the field, the stock input
            group, as the airplane form's figures have theirs. */}
        <InputGroup className="h-10 flex-1 font-mono">
          <InputGroupInput
            value={course} onChange={e => setCourse(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="090" inputMode="numeric" spellCheck={false} aria-label={`Magnetic course from ${from}, degrees`}
            className="font-mono" data-testid="fix-from-course"
          />
          <InputGroupAddon align="inline-end"><InputGroupText>°</InputGroupText></InputGroupAddon>
        </InputGroup>
        <InputGroup className="h-10 flex-1 font-mono">
          <InputGroupInput
            value={distance} onChange={e => setDistance(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
            placeholder="30" inputMode="decimal" spellCheck={false} aria-label={`Distance from ${from}, nautical miles`}
            className="font-mono" data-testid="fix-from-distance"
          />
          <InputGroupAddon align="inline-end"><InputGroupText>nm</InputGroupText></InputGroupAddon>
        </InputGroup>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction type="submit" disabled={!valid} onClick={e => { e.preventDefault(); create(); }} data-testid="fix-from-add">
          Add
        </AlertDialogAction>
      </AlertDialogFooter>
    </form>
  );
}
