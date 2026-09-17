import type { ReactNode } from "react";

/** A collapsed-by-default `<details>` block with a consistent title
 *  style -- shared by the Flight Briefing page and the Playground,
 *  both of which are "skim titles, open what's relevant" pages rather
 *  than a single continuous document. `print:break-inside-avoid` (and
 *  `break-inside-avoid-page`) only matter on the Flight Briefing page,
 *  which prints; they're inert elsewhere.
 *
 *  Native `<details>`, not shadcn's `Collapsible` (Radix): zero
 *  library code -- a browser primitive, not an import -- and it
 *  fixes a real regression the Radix version had: Radix unmounts
 *  closed content entirely, so a printed page with any section left
 *  collapsed was missing it; `<details>` never removes its content
 *  from the DOM, only hides it, which is what this page's own print
 *  stylesheet (`@media print { details { display: block !important } }`
 *  in index.css) can actually override. */
export default function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="break-inside-avoid-page border-b border-border px-4 py-3 print:break-inside-avoid">
      <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted-foreground print:cursor-default">
        {title}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
