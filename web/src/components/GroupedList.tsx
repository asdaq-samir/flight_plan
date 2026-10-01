import { Children, Fragment, useId, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "cn";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "./ui/item";
import { Label } from "./ui/label";
import { TEXT } from "../lib/text";

/**
 * The app's grouped lists, the way iOS lays out Settings and a
 * briefing: an optional short heading, the rows in one rounded box with
 * a hairline between each, and a note under the box. Built on shadcn's
 * Item. The settings are these, and so are the flight planning drawer's
 * sections' contents: one look for anything that is a list of things
 * with a value or a control at the end. At the app's sizes for a list
 * (TEXT): to a finger, 17 points for a row and 15 under it, the
 * heading and the note 13. `action` sits at the heading's end: an Edit
 * for the list, as iOS puts one in the bar over it.
 */
export function ListGroup({ title, action, footer, children, className }: {
  title?: string;
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
          <h3 id={id} className={cn("px-1 pb-1.5 font-semibold tracking-wide text-muted-foreground uppercase", TEXT.note)}>{title}</h3>
          {action}
        </div>
      )}
      <ItemGroup role="group" aria-labelledby={title ? id : undefined} className="gap-0 rounded-lg border border-border bg-card">
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
export function ListRow({ id, media, title, description, value, href, to, chevron, children, ...buttonProps }: {
  id?: string;
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  href?: string;
  to?: string;
  chevron?: boolean;
  children?: ReactNode;
} & Omit<ComponentProps<"button">, "title" | "value" | "children">) {
  const choice = buttonProps.role === "checkbox" || buttonProps.role === "radio" || buttonProps["aria-pressed"] !== undefined;
  const opens = chevron || to !== undefined;
  const action = href !== undefined || (!!buttonProps.onClick && !opens && !choice);
  // The words wrap, where the stock Item cuts its title at one line and
  // its description at two: as an iOS row's do with the text set larger,
  // and a row's words are all of what it says.
  const body = (
    <>
      {media && <ItemMedia className={cn(action && "text-tint")}>{media}</ItemMedia>}
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={cn("line-clamp-none font-normal", TEXT.row, action && "text-tint")}>
          {id ? <Label htmlFor={id} className={cn("font-normal", TEXT.row)}>{title}</Label> : title}
        </ItemTitle>
        {description && <ItemDescription className={cn("line-clamp-none", TEXT.detail)}>{description}</ItemDescription>}
      </ItemContent>
      {(value !== undefined || children || href || opens) && (
        <ItemActions className="ml-auto">
          {value !== undefined && <span className={cn("text-muted-foreground tabular-nums", TEXT.row)}>{value}</span>}
          {children}
          {href && <ExternalLink className="size-4 text-tint" aria-hidden />}
          {opens && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
        </ItemActions>
      )}
    </>
  );
  if (to !== undefined) {
    return (
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 no-underline! hover:bg-muted/50 pointer-coarse:active:bg-muted">
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
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 no-underline!">
        <a href={href} target="_blank" rel="noreferrer">{body}</a>
      </Item>
    );
  }
  if (buttonProps.onClick) {
    return (
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 text-left hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50 pointer-coarse:active:bg-muted">
        <button type="button" {...buttonProps}>{body}</button>
      </Item>
    );
  }
  return <Item size="sm" className="min-h-11 rounded-none border-0 py-2">{body}</Item>;
}
