import type { ComponentProps } from "react";
import { SquareTerminal } from "lucide-react";
import IconButton from "../../components/IconButton";

/** The header button that opens the console: a `SheetTrigger` child,
 *  so the sheet's own open state, click and `aria-expanded` arrive as
 *  props and land on the button. A console glyph, not the flask: the
 *  flask is the Dev page's own mark, and one glyph should mean one
 *  thing.
 *
 *  Its own file, away from the console it opens: the button is in the
 *  header of both pages, and importing it from `DevPanel` pulled that
 *  whole console -- charts, tables, the retrain client -- into the
 *  chunk a pilot loads to look at a map. */
export function DevButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Developer" data-testid="dev-console-button" {...props}>
      <SquareTerminal className="size-5" />
    </IconButton>
  );
}
