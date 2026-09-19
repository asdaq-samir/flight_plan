import { ArrowRight } from "lucide-react";
import RouteInputGroup from "../../../components/RouteInputGroup";
import { InputGroupButton } from "../../../components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
}

export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit,
}: Props) {
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={e => {
        e.preventDefault();
        // Without this, focus stays on whichever input was last
        // typed in, and the keyboard handler ignores every key while
        // an input has focus -- so Space wouldn't start the walk
        // right after loading a route, only after clicking the map.
        (document.activeElement as HTMLElement | null)?.blur();
        onSubmit();
      }}
    >
      {/* Same shape as Plan's own DEP/DEST/Load now (`RouteInputGroup`)
          -- this page used to run its own inputs taller (h-10,
          deliberately bigger tap targets) than Plan's did, one more
          place the two pages looked like different designs rather
          than the same shell around a different sidebar. */}
      <RouteInputGroup
        dep={dep} dest={dest}
        onDepChange={v => onDepChange(v.toUpperCase())}
        onDestChange={v => onDestChange(v.toUpperCase())}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton type="submit" variant="default" size="icon-sm">
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
