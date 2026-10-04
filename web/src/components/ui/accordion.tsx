import * as React from "react"
import { cn } from "cn"
import { Accordion as AccordionPrimitive } from "radix-ui"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

function Accordion({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  )
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  label,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  /** What names the trigger, laid over it in the header rather than
   *  inside it, so a control among it (a flag beside a section's title)
   *  is not a button inside a button. Name the trigger from it with
   *  aria-labelledby; the trigger stays the whole row's tap. */
  label?: React.ReactNode
}) {
  return (
    <AccordionPrimitive.Header data-slot="accordion-header" className={label ? "group/accordion-header grid" : "flex"}>
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-md border border-transparent py-4 text-left text-sm font-medium transition-all outline-none hover:underline pointer-coarse:active:opacity-60 pointer-coarse:active:duration-0 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:after:border-ring disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-tint",
          label && "col-start-1 row-start-1",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon data-slot="accordion-trigger-icon" className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden" />
        <ChevronUpIcon data-slot="accordion-trigger-icon" className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline" />
      </AccordionPrimitive.Trigger>
      {label}
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      // Clipped for the open/close animation, as shadcn's overflow-hidden
      // clipped it, but without becoming a scroll container: a sticky
      // heading inside (the nav log's) can then hold to the drawer's
      // own scroll, where overflow-hidden held it to this box. Up and
      // down only, which is all the animation needs: clipped sideways
      // too, a control at the section's edge lost the side of its
      // 44-point hit area (the nav log's wand).
      className="overflow-y-clip text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      {/* No fixed height on the inner div: Radix measures the content
          once, as the section opens, and a height pinned to that
          measurement clipped whatever arrived afterwards -- a table
          filling in from a query, a chart growing to its rows. The
          open/close animation is the Content's own, from zero to that
          measured height, and it ends at `auto`. */}
      <div
        className={cn(
          "pt-0 pb-4 [&_a]:text-tint [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
