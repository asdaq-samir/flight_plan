import * as React from "react"
import { cn } from "cn"

/**
 * A plain scrolling `<div>`, not Radix's own ScrollArea primitive.
 *
 * Every caller here caps this with a viewport-relative `max-h-[...]`
 * (so short content doesn't force a tall empty box) rather than a
 * fixed height the way shadcn's own docs examples use ScrollArea --
 * and Radix's own Viewport (a nested `size-full`/`height: 100%` div)
 * never actually resolves that against a `max-height`-only ancestor,
 * however that ancestor's own height is produced (a bare `max-height`,
 * or even a flex item's own `flex-1`/`min-h-0` computing a genuine,
 * definite used height): the Viewport still renders at its full,
 * unclipped content height regardless, and since nothing then clips
 * it, that excess spills out past whatever drawer or popover it was
 * supposed to stay inside, instead of scrolling. A native `overflow-y-
 * auto` on the same element `max-height` is already applied to needs
 * none of that cross-element resolution -- the clip and the cap are
 * the same box, which is the one combination this exact bug can't
 * reach. The cost is a browser-native scrollbar instead of a custom-
 * styled one, not worth reopening this over.
 */
function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("overflow-y-auto", className)} {...props}>
      {children}
    </div>
  )
}

export { ScrollArea }
