import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Colored on the icon itself, not the card -- the card went
      // neutral for every toast (see --error-bg below), so the icon is
      // now the only thing saying info/success/failure apart at all,
      // and a same-color glyph next to a same-color card would say
      // nothing. `text-destructive` reuses this app's own existing red
      // (Button's own destructive variant); green/amber/blue are
      // plain, theme-agnostic semantic colors this app has no token
      // for yet, with a dark:-variant each the same way every other
      // hand-picked color in this app gets one.
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-green-600 dark:text-green-500" />
        ),
        info: (
          <InfoIcon className="size-4 text-blue-600 dark:text-blue-500" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-500" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-destructive" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
      style={
        {
          // 25% opaque (75% transparent), not solid -- a toast floats
          // directly over the map (see main.tsx's own comment on why),
          // and this app's maps are never blank underneath it, so a
          // solid card would block real content a pilot might still
          // want to see past it. Text/icon stay at full opacity
          // regardless (`--normal-text`/`--error-text` are colors, not
          // alpha) -- only the card itself thins out. backdrop-blur
          // (className below) is what keeps that legible over a busy
          // sectional chart rather than just a translucent smear of
          // whatever's behind it.
          "--normal-bg": "color-mix(in oklab, var(--popover) 25%, transparent)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // One card style for every kind of toast -- the icon (see
          // `icons` above) is what says info/success/failure apart,
          // not a second, color-coded background on top of it. Sonner
          // colors error toasts red on its own otherwise; pointed back
          // at the same neutral tokens as everything else here.
          "--error-bg": "color-mix(in oklab, var(--popover) 25%, transparent)",
          "--error-text": "var(--popover-foreground)",
          "--error-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast backdrop-blur-sm",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
