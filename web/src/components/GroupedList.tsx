import { Children, Fragment, useId, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "./ui/item";
import { Label } from "./ui/label";

/**
 * The app's grouped lists, the way iOS lays out Settings and a
 * briefing: an optional short heading, the rows in one rounded box with
 * a hairline between each, and a note under the box. Built on shadcn's
 * Item. The settings are these, and so are the flight planning drawer's
 * sections' contents: one look for anything that is a list of things
 * with a value or a control at the end.
 */
export function ListGroup({ title, footer, children, className }: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section aria-labelledby={title ? id : undefined} className={className}>
      {title && <h3 id={id} className="px-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>}
      <ItemGroup role="group" aria-labelledby={title ? id : undefined} className="gap-0 rounded-lg border border-border bg-card">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <ItemSeparator className="my-0" />}
            {row}
          </Fragment>
        ))}
      </ItemGroup>
      {footer && <p className="px-1 pt-1.5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

/**
 * One row: its name and a line of help, and at its end a control
 * (`children`) or a value (`value`, muted, in tabular figures) -- under
 * the words, when the row is too narrow for both. With `id`, the name is
 * the control's label, so a tap on the words works it. With `href`, the
 * whole row is a link out, marked as one.
 */
export function ListRow({ id, title, description, value, href, children }: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  href?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-normal">
          {id ? <Label htmlFor={id} className="font-normal">{title}</Label> : title}
        </ItemTitle>
        {description && <ItemDescription className="text-xs">{description}</ItemDescription>}
      </ItemContent>
      {(value !== undefined || children || href) && (
        <ItemActions className="ml-auto">
          {value !== undefined && <span className="text-sm text-muted-foreground tabular-nums">{value}</span>}
          {children}
          {href && <ExternalLink className="size-4 text-muted-foreground" aria-hidden />}
        </ItemActions>
      )}
    </>
  );
  if (href) {
    return (
      // no-underline!: a section's own links are underlined (the
      // accordion's content styles every <a>), and a row is not prose.
      <Item asChild size="sm" className="min-h-11 rounded-none border-0 py-2 no-underline!">
        <a href={href} target="_blank" rel="noreferrer">{body}</a>
      </Item>
    );
  }
  return <Item size="sm" className="min-h-11 rounded-none border-0 py-2">{body}</Item>;
}
