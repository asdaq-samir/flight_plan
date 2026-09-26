import { ArrowRight } from "lucide-react";
import AirportPicker from "./AirportPicker";
import { InputGroup, InputGroupAddon, InputGroupButton } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

/** DEP → DEST and its Load button, the same on Plan and Label. Each
 *  field is an `AirportPicker`, the stock combobox: a button that opens
 *  a searchable list of idents and names. */
export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit, disabled = false,
}: Props) {
  return (
    // flex-wrap, not a fixed single line -- DEP/DEST need their full
    // width to actually show a 4-letter ident (a narrower box clips
    // the text itself, not just the row around it, which is worse:
    // wrong-looking data, not just a layout that needs a scroll or a
    // second glance). On a phone the group is slimmed to fit the
    // header's one line beside the icon buttons (see RouteInputGroup);
    // wrapping is the fallback for a screen narrower than that, and
    // costs nothing here where a hidden/clipped identifier would.
    <form
      className="flex flex-wrap items-center gap-1.5"
      autoComplete="off"
      onSubmit={e => {
        e.preventDefault();
        // Label's keyboard shortcuts ignore every key while an input
        // has focus, so without this Space wouldn't start the walk
        // right after loading a route, only after clicking the map.
        (document.activeElement as HTMLElement | null)?.blur();
        onSubmit();
      }}
    >
      <InputGroup className="w-auto">
        <AirportPicker value={dep} onChange={v => onDepChange(v.toUpperCase())} placeholder="DEP" ariaLabel="Departure" className="min-w-20" />
        <span className="text-muted-foreground" aria-hidden="true">→</span>
        <AirportPicker value={dest} onChange={v => onDestChange(v.toUpperCase())} placeholder="DEST" ariaLabel="Destination" className="min-w-20" />
        <InputGroupAddon align="inline-end" className="gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={disabled}>
                <ArrowRight />
                <span className="sr-only">Load</span>
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>Load</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
