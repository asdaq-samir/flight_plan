import { useId, useState } from "react";
import SheetDialog from "../../../components/SheetDialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../../components/ui/input-group";
import { frdIdent } from "../../../lib/identSchema";

/**
 * The pilot's own point off a point of the route, from its menu's "Create
 * a fix from here…", at the owner's ask ("30 miles 090 radial of vpbng",
 * "a fix should get its own row"): its magnetic course from there -- a
 * VOR's radial -- and how far, as a flight plan writes a fix/radial/
 * distance (FAA Form 7233-4), and the route flies over it next. Asked as
 * iOS asks for a figure or two: an alert with its fields from `md` up, and
 * on a phone a sheet with Cancel and Add in its title row (SheetDialog).
 */
export default function FixFromDialog({ from, onClose, onCreate }: {
  /** The point it is measured from; null, put away. */
  from: string | null;
  onClose: () => void;
  onCreate: (ident: string) => void;
}) {
  // Kept as it closes, so its words stay as it slides away; and empty
  // again each time it is opened.
  const [was, setWas] = useState(from);
  const [shown, setShown] = useState(from);
  const [course, setCourse] = useState("");
  const [distance, setDistance] = useState("");
  if (from !== was) {
    setWas(from);
    if (from) {
      setShown(from);
      setCourse("");
      setDistance("");
    }
  }
  const form = useId();
  const at = shown ?? "";
  const deg = course.length === 3 ? Number(course) : NaN;
  const nm = Number(distance);
  // A course of 001 to 360 (000 is 360), out to 999 nm, as the planner
  // takes one (vfr.fixes.parse_frd).
  const valid = deg >= 0 && deg <= 360 && nm > 0 && nm <= 999;
  const ident = valid ? frdIdent(at, deg, nm) : null;
  return (
    <SheetDialog
      open={!!from} onOpenChange={open => { if (!open) onClose(); }} alert cancel size="sm"
      title={`A fix from ${at}`}
      description={`Its magnetic course from ${at}, a VOR's radial, and how far. Flown over next${ident ? `: ${ident}` : "."}`}
      action={{ label: "Add", form, disabled: !valid, testId: "fix-from-add" }}
      onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
    >
      <form id={form} onSubmit={e => { e.preventDefault(); if (ident) onCreate(ident); }} className="flex gap-2">
        {/* Each figure with its unit inside the field, the stock input
            group, as the airplane form's figures have theirs. */}
        <InputGroup className="h-10 flex-1 font-mono">
          <InputGroupInput
            value={course} onChange={e => setCourse(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="090" inputMode="numeric" spellCheck={false} aria-label={`Magnetic course from ${at}, degrees`}
            className="font-mono" data-testid="fix-from-course"
          />
          <InputGroupAddon align="inline-end"><InputGroupText>°</InputGroupText></InputGroupAddon>
        </InputGroup>
        <InputGroup className="h-10 flex-1 font-mono">
          <InputGroupInput
            value={distance} onChange={e => setDistance(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
            placeholder="30" inputMode="decimal" spellCheck={false} aria-label={`Distance from ${at}, nautical miles`}
            className="font-mono" data-testid="fix-from-distance"
          />
          <InputGroupAddon align="inline-end"><InputGroupText>nm</InputGroupText></InputGroupAddon>
        </InputGroup>
      </form>
    </SheetDialog>
  );
}
