import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  onInteractOutside,
  onCloseAutoFocus,
  ref,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // Opened again as it eased out -- its button tapped again just after it
  // was put away -- it took that tap for one outside it, heard as it eased
  // out, and shut again (the other session's tracking:324, on a desktop's
  // picker). A tap that came while it was going is not one to close it on.
  const content = React.useRef<HTMLDivElement | null>(null)
  const goingAtTap = React.useRef(false)
  React.useEffect(() => {
    const down = () => { goingAtTap.current = content.current?.getAttribute("data-state") === "closed" }
    // After the tap's own click, which is when a touch's is answered.
    const done = () => { window.setTimeout(() => { goingAtTap.current = false }, 0) }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("click", done, true)
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("click", done, true)
    }
  }, [])
  const setContent = React.useCallback((node: HTMLDivElement | null) => {
    content.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={setContent}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        onInteractOutside={event => {
          if (goingAtTap.current) event.preventDefault()
          onInteractOutside?.(event)
        }}
        // Gone, the focus back to its button, unless it is somewhere already
        // (ui/sheet's SheetContent says why).
        onCloseAutoFocus={event => {
          const active = document.activeElement
          if (active && active !== document.body) event.preventDefault()
          onCloseAutoFocus?.(event)
        }}
        className={cn(
          "z-50 flex max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 overflow-y-auto rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
