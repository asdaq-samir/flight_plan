import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Matches shadcn's own registry file for this component, deliberately --
// an earlier version here hand-picked icons and pinned every toast's
// background/border to the same neutral, translucent card, which fought
// the `richColors` prop main.tsx sets (that's sonner's own single
// built-in switch for a per-type background/border/icon all three
// together, not separately) and left this looking different from the
// reference demo (SonnerTypes) a same-colored card and icon per type,
// stacking as you fire more than one. Only `--normal-bg` etc. below stay
// customized (light/dark tokens instead of sonner's own hardcoded
// white/black) -- the rest is stock.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
