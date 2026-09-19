import { cn } from "cn";
import { Input } from "./ui/input";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  /** Whether a route error should mark these invalid -- the one
   *  difference from a plain pair of inputs this component still
   *  needs a prop for, now that its other former callers (which also
   *  varied uppercasing and a datalist) have moved to
   *  `RouteInputGroup` instead. */
  invalid?: boolean;
  /** Settings' own Algorithm Picker panel runs these narrower (`w-20`)
   *  than its own former `w-[75px]` default -- a route there is a
   *  one-off lookup, not a page's own primary input, so it doesn't
   *  need the room a full 4-letter ident without clipping asked for
   *  elsewhere. Required now that this is its only caller, rather than
   *  a default every other caller relied on. */
  widthClassName: string;
}

/** DEP `->` DEST -- Settings' own Dev ML tab's Algorithm Picker panel,
 *  now its only caller. Plan's and Label's own `RouteForm` used to
 *  build this same shape by hand too, until both moved to
 *  `RouteInputGroup` instead (DEP/DEST plus their own trailing Load
 *  button, bordered as one shadcn `InputGroup`) -- a treatment that
 *  belongs on a page's own primary input, not this panel's one-off
 *  lookup. Deliberately just the two inputs and the arrow between
 *  them, not a `<form>` of its own -- the one remaining caller already
 *  has its own surrounding form with its own submit button, and
 *  wrapping this in a second one would nest forms. */
export default function IdentPairInputs({
  dep, dest, onDepChange, onDestChange, invalid, widthClassName,
}: Props) {
  return (
    <>
      <Input
        value={dep}
        onChange={e => onDepChange(e.target.value)}
        placeholder="DEP"
        spellCheck={false}
        aria-label="Departure"
        aria-invalid={invalid}
        className={cn("text-center font-mono uppercase", widthClassName)}
      />
      <span>→</span>
      <Input
        value={dest}
        onChange={e => onDestChange(e.target.value)}
        placeholder="DEST"
        spellCheck={false}
        aria-label="Destination"
        aria-invalid={invalid}
        className={cn("text-center font-mono uppercase", widthClassName)}
      />
    </>
  );
}
