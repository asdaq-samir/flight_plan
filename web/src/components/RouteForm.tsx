import { ArrowRight } from "lucide-react";
import RouteInputGroup from "./RouteInputGroup";
import { InputGroupButton } from "./ui/input-group";
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
 *  field is an `AirportSearchInput`, whose own dropdown suggests idents
 *  and names as a pilot types. */
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
      <RouteInputGroup
        dep={dep} dest={dest}
        onDepChange={v => onDepChange(v.toUpperCase())}
        onDestChange={v => onDestChange(v.toUpperCase())}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={disabled}>
              <ArrowRight />
              <span className="sr-only">Load</span>
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>Load</TooltipContent>
        </Tooltip>
      </RouteInputGroup>
    </form>
  );
}
