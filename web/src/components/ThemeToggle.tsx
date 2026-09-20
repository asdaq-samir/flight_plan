import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import IconButton from "./IconButton";

const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];
const LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
const ICON = { system: Monitor, light: Sun, dark: Moon };

/**
 * Cycles system -> light -> dark. Dark is not decoration here: a pilot
 * planning at night, or reading the nav log in a dim cockpit before
 * departure, wants the page as dim as the panel lights. `next-themes`
 * (already behind the toast Toaster) keeps the choice in localStorage,
 * follows the OS while on "system", and sets the `dark` class every
 * token in index.css keys off.
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current: Theme = (ORDER as readonly string[]).includes(theme ?? "") ? (theme as Theme) : "system";
  const next: Theme = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";
  const Icon = ICON[current];
  return (
    <IconButton label={LABEL[current]} onClick={() => setTheme(next)} data-testid="theme-toggle">
      <Icon className="size-5" />
    </IconButton>
  );
}
