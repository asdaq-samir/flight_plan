import { ArrowRight } from "lucide-react";
import RouteInputGroup from "../../../components/RouteInputGroup";
import { InputGroupButton } from "../../../components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { BuiltRoute } from "../../../lib/api/types";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  routes: BuiltRoute[];
}

export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit, disabled, routes,
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
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
    >
      <RouteInputGroup dep={dep} dest={dest} onDepChange={onDepChange} onDestChange={onDestChange} listId="built">
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
      <datalist id="built">
        {[...new Set(routes.flatMap(r => [r.departure_ident, r.destination_ident]))]
          .sort().map(id => <option key={id} value={id} />)}
      </datalist>
    </form>
  );
}
