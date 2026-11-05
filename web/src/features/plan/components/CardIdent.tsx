import { useState } from "react";
import { cn } from "cn";
import { TEXT } from "../../../lib/text";

/**
 * A card's ident a text box, at the owner's ask (2026-11-05: "the airport
 * id should be a text box", after "Make the cards airport ids editable so
 * it can be changed to anything"): typed over and taken as typed on Return
 * or as it is left, Escape putting it back. The app's neutral fill, a
 * field's, its width the ident's (or the card's, `wide`); over the head's
 * tap that folds the card. In the Plan's every card has one, the two ends'
 * before there is a route (RouteEnds) and a stop's being added
 * (ProceduresRoute), there being no route box there ("I want to
 * completely get rid of the route box for in the plan").
 */
export default function CardIdent({ value, label, onCommit, testId, bold = true, placeholder, autoFocus = false, wide = false, onEmpty }: {
  value: string;
  label: string;
  onCommit: (ident: string) => void;
  testId: string;
  bold?: boolean;
  /** Its words while empty, in their own case. */
  placeholder?: string;
  autoFocus?: boolean;
  /** The rest of the card's line, not the ident's width. */
  wide?: boolean;
  /** Left empty: a stop being added, given up. */
  onEmpty?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Its ident again where the route changed it from elsewhere.
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim().toUpperCase();
    if (next && next !== value) onCommit(next);
    else if (!next && onEmpty) onEmpty();
    else setDraft(value);
  };
  // As wide as what it holds: the input over a hidden copy of its words in
  // one grid cell, the copy giving the width, where its `size` in
  // characters cut KUGN's N off in the semibold capitals (the owner's
  // screenshot, 2026-11-05).
  const box = (
    <input
      value={draft} aria-label={label} data-testid={testId} placeholder={placeholder} autoFocus={autoFocus}
      autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="done"
      size={1}
      onChange={e => setDraft(e.target.value.toUpperCase())}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
      }}
      className={cn(
        "relative z-10 -my-0.5 min-w-0 rounded-md bg-foreground/8 px-1.5 py-0.5 uppercase outline-none placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        bold ? "font-semibold" : "font-normal", wide ? "w-full flex-1 py-1.5" : "col-start-1 row-start-1 w-full", TEXT.row,
      )}
    />
  );
  if (wide) return box;
  return (
    <span className="inline-grid min-w-0">
      <span aria-hidden="true" className={cn("invisible col-start-1 row-start-1 -my-0.5 px-1.5 py-0.5 whitespace-pre", draft || !placeholder ? cn("uppercase", bold ? "font-semibold" : "font-normal") : "font-normal", TEXT.row)}>
        {(draft || placeholder || "WWW") + " "}
      </span>
      {box}
    </span>
  );
}
