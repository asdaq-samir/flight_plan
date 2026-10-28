import { Children, Fragment, useId, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, ExternalLink } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { RadioGroup } from "./ui/radio-group";
import { cn } from "cn";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "./ui/item";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { GROUP_HEADING, TEXT } from "../lib/text";

/**
 * The app's grouped lists, the way iOS lays out Settings and a
 * briefing: an optional short heading, the rows in one rounded box with
 * a hairline between each, and a note under the box. Built on shadcn's
 * Item. The settings are these, and so are the flight planning drawer's
 * sections' contents: one look for anything that is a list of things
 * with a value or a control at the end. At the app's sizes for a list
 * (TEXT): to a finger, 17 points for a row and 15 under it, the
 * heading and the note 13. `action` sits at the heading's end: an Edit
 * for the list, as iOS puts one in the bar over it; `badge` beside the
 * heading, what the whole group's state is.
 */
export function ListGroup({ title, badge, action, footer, children, className }: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section aria-labelledby={title ? id : undefined} className={className}>
      {title && (
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <h3 id={id} className={GROUP_HEADING}>{title}</h3>
            {badge}
          </div>
          {action}
        </div>
      )}
      {/* No gaps between the rows, the stock group's ten for small rows
          (has-data-[size=sm]) too, which its plain gap-0 did not reach: a
          band above and below every row that a tap did nothing on (the
          owner's screenshot, 2026-10-28). The rows' own padding is the
          room between them instead (ListRow, 13 a side in a group). */}
      <ItemGroup role="group" aria-labelledby={title ? id : undefined} className="gap-0 rounded-lg border border-border bg-card has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <ItemSeparator className="my-0" />}
            {row}
          </Fragment>
        ))}
      </ItemGroup>
      {footer && <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>{footer}</p>}
    </section>
  );
}

/**
 * One row: its name and a line of help, and at its end a control
 * (`children`) or a value (`value`, muted, in tabular figures) -- under
 * the words, when the row is too narrow for both; before them, `media`,
 * a mark of what the row is (a rating's badge, a hazard's triangle).
 * With `id`, the name is the control's label, so a tap on the words
 * works it. With `href`, the whole row is a link out, marked as one;
 * with `to`, a link to one of the app's own pages, with the chevron.
 * With `onClick` (or as a trigger's `asChild` child, which hands it
 * one), the whole row is a button, and `chevron` marks it as opening
 * something, as an iOS row does; the rest of the props (a name, a test
 * id, a trigger's own, `disabled`) go on that button. A row that does
 * something when tapped -- a link, an action, not one that opens
 * something (the chevron's) or a choice (a checkmark's: `role` checkbox
 * or radio, or `aria-pressed`) -- has its name in the tint, as an iOS
 * row does; it read as one more line of text.
 */
// A row's classes merged once, not in every row's every render: tailwind-
// merge was the Airports tab's largest piece of script on first opening
// (39 ms of 60, measured), a frequency list being many rows.
const TITLE = cn("line-clamp-none font-normal", TEXT.row);
const TITLE_ACTION = cn(TITLE, "text-tint");
const LABEL = cn("font-normal", TEXT.row);
const DESCRIPTION = cn("line-clamp-none", TEXT.detail);
const VALUE = cn("text-muted-foreground tabular-nums", TEXT.row);

export function ListRow({ id, media, title, description, value, href, to, chevron, checkbox, radio, wide, muted, children, ...buttonProps }: {
  id?: string;
  /** A note in place of a row -- none yet, could not be had -- its words in
   *  the secondary grey, where 32 rows wrote that grey round their title. */
  muted?: boolean;
  /** The title the row's whole width, for a row laid out in columns of
   *  its own (a flight's two ends, FlightEnds): the stock title is as wide
   *  as its words. */
  wide?: boolean;
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  href?: string;
  to?: string;
  chevron?: boolean;
  /** A row that is a checkbox: shadcn's (Radix's) at its start, the whole
   *  row its label, so a tap anywhere on it ticks it. The row's test id
   *  goes on the checkbox, which carries `aria-checked`. */
  checkbox?: { checked: boolean; onChange: (checked: boolean) => void };
  /** A row that is one of a radio group's choices, this its value: Radix's
   *  radio item (arrow keys between the choices, `aria-checked`), marked
   *  with iOS's checkmark in the tint, as a list's one choice is on iOS
   *  (the HIG), not a radio's dot. Inside a `ListChoices`. */
  radio?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"button">, "title" | "value" | "children">) {
  const choice = !!checkbox || radio !== undefined || buttonProps["aria-pressed"] !== undefined;
  // A radio's mark, iOS's checkmark, shown by the item's own state.
  const mark = radio !== undefined ? <Check className="size-4 text-tint invisible group-data-[state=checked]:visible" aria-hidden /> : media;
  const opens = chevron || to !== undefined;
  const action = href !== undefined || (!!buttonProps.onClick && !opens && !choice);
  // The words wrap, where the stock Item cuts its title at one line and
  // its description at two: as an iOS row's do with the text set larger,
  // and a row's words are all of what it says.
  const body = (
    <>
      {checkbox ? (
        <ItemMedia>
          <Checkbox
            checked={checkbox.checked} onCheckedChange={on => checkbox.onChange(on === true)}
            data-testid={(buttonProps as { "data-testid"?: string })["data-testid"]}
          />
        </ItemMedia>
      ) : mark && <ItemMedia className={cn(action && "text-tint")}>{mark}</ItemMedia>}
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={cn(action ? TITLE_ACTION : TITLE, wide && "w-full")}>
          {id ? <Label htmlFor={id} className={LABEL}>{title}</Label> : muted ? <span className="text-muted-foreground">{title}</span> : title}
        </ItemTitle>
        {description && <ItemDescription className={DESCRIPTION}>{description}</ItemDescription>}
      </ItemContent>
      {(value !== undefined || children || href || opens) && (
        <ItemActions className="ml-auto">
          {value !== undefined && <span className={VALUE}>{value}</span>}
          {children}
          {href && <ExternalLink className="size-4 text-tint" aria-hidden />}
          {opens && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
        </ItemActions>
      )}
    </>
  );
  // Each row 44 at the least, as iOS's grouped lists have them: the row
  // is the control, so its own height is its hit area.
  if (to !== undefined) {
    return (
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px] no-underline! hover:bg-muted/50 pointer-coarse:active:bg-muted">
        {/* What a wrapper hands a row (a sheet's Close, its click) goes
            on the link; a button's own attributes do not. */}
        <Link
          to={to} className={buttonProps.className} aria-label={buttonProps["aria-label"]}
          onClick={buttonProps.onClick as ComponentProps<typeof Link>["onClick"]}
          data-testid={(buttonProps as { "data-testid"?: string })["data-testid"]}
        >
          {body}
        </Link>
      </Item>
    );
  }
  if (href) {
    return (
      // no-underline!: a section's own links are underlined (the
      // accordion's content styles every <a>), and a row is not prose.
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px] no-underline!">
        {/* A click handler goes on the link too, run before it opens: a
            row that copies what the site it opens is to be given (the
            Brief's Open in 1800wxbrief), in the tap's own gesture. */}
        <a
          href={href} target="_blank" rel="noreferrer"
          onClick={buttonProps.onClick as ComponentProps<"a">["onClick"]}
          data-testid={(buttonProps as { "data-testid"?: string })["data-testid"]}
        >{body}</a>
      </Item>
    );
  }
  if (checkbox) {
    // A label round the row, so a tap anywhere on it is a tap on the box.
    return (
      <Item asChild size="sm" className="min-h-11 cursor-pointer rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px] hover:bg-muted/50 pointer-coarse:active:bg-muted">
        <label className={buttonProps.className}>{body}</label>
      </Item>
    );
  }
  if (radio !== undefined) {
    return (
      <Item asChild size="sm" className="group min-h-11 rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px] text-left hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50 pointer-coarse:active:bg-muted">
        <RadioGroupPrimitive.Item value={radio} asChild disabled={buttonProps.disabled}>
          <button type="button" {...buttonProps}>{body}</button>
        </RadioGroupPrimitive.Item>
      </Item>
    );
  }
  if (buttonProps.onClick) {
    return (
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px] text-left hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50 pointer-coarse:active:bg-muted">
        <button type="button" {...buttonProps}>{body}</button>
      </Item>
    );
  }
  // A plain row keeps its test id, its class and whether it is the one
  // picked (aria-current), the attributes of a button's it has a use for.
  return (
    <Item
      size="sm" className={cn("min-h-11 rounded-none border-0 py-2 in-data-[slot=item-group]:py-[13px]", buttonProps.className)} aria-current={buttonProps["aria-current"]}
      data-testid={(buttonProps as { "data-testid"?: string })["data-testid"]}
    >
      {body}
    </Item>
  );
}

/**
 * A list's one choice, as iOS has it: its rows (`ListRow` with `radio`)
 * a Radix radio group -- arrow keys between them, one checked, the
 * group named -- around the grouped list.
 */
export function ListChoices({ value, onChange, label, children }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <RadioGroup value={value} onValueChange={onChange} aria-label={label} className="block">
      {children}
    </RadioGroup>
  );
}
