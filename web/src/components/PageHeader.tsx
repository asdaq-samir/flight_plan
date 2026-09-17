import { Link, useLocation } from "react-router-dom";
import { Settings } from "lucide-react";
import { Button } from "./ui/button";

/**
 * The one piece of chrome every page but Plan shares (Plan folds this
 * same pair -- go home, open Settings -- into its own single-row
 * header alongside the route form; see PlanView's own comment) --
 * "VFR Route" (linking to Plan, the app's own homepage) on the left, a
 * bare gear icon (linking to Settings, where everything that isn't
 * the map now lives -- Dev, Account and the old Home page's own
 * overview all folded into it) on the right. `print:hidden`: this has
 * no place on the printed Flight Briefing page, the one document this
 * app ever produces that leaves the browser.
 *
 * Just the two destinations -- there's nothing left to navigate
 * *between*, only somewhere to go and a way back, so this is a plain
 * shadcn `Button` (`variant` doing the active-state work a Radix
 * `NavigationMenu` doesn't need to exist for one item), not a nav list.
 */
export default function PageHeader() {
  const { pathname } = useLocation();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 print:hidden">
      <Link to="/plan" className="text-sm font-bold tracking-tight text-foreground">
        VFR Route
      </Link>
      <Button
        asChild
        variant={pathname === "/settings" ? "default" : "ghost"}
        size="icon"
        aria-label="Settings"
      >
        <Link to="/settings">
          <Settings className="size-4" />
        </Link>
      </Button>
    </header>
  );
}
