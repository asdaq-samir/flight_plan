import { ArrowRight } from "lucide-react";
import RouteInputGroup from "./RouteInputGroup";
import { InputGroupButton } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { BuiltRoute } from "../lib/api/types";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Corridors already built, offered as a native datalist on both
   *  inputs. Plan passes them; Label has no equivalent list. */
  routes?: BuiltRoute[];
}

/** DEP → DEST and its Load button, the same on Plan and Label. */
export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit, disabled = false, routes,
}: Props) {
  return (
    // flex-wrap, not a fixed single line -- DEP/DEST need their full
    // width to actually show a 4-letter ident (a narrower box clips
    // the text itself, not just the row around it, which is worse:
    // wrong-looking data, not just a layout that needs a scroll or a
    // second glance). Wrapping onto a second line on a narrow phone
    // screen costs nothing here; a hidden/clipped identifier would.
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
        listId={routes ? "built" : undefined}
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
      {routes && (
        <datalist id="built">
          {[...new Set(routes.flatMap(r => [r.departure_ident, r.destination_ident]))]
            .sort().map(id => <option key={id} value={id} />)}
        </datalist>
      )}
    </form>
  );
}
