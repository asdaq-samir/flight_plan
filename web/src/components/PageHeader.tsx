import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList,
} from "./ui/navigation-menu";

const LINKS: { page: string; to: string; label: string }[] = [
  { page: "plan", to: "/plan", label: "Plan" },
  { page: "label", to: "/label", label: "Label" },
  { page: "playground", to: "/playground", label: "Playground" },
  { page: "account", to: "/account", label: "Account" },
];

/**
 * The one piece of chrome every page shares -- "VFR Route" (linking
 * home) on the left, the other three pages on the right via shadcn's
 * `NavigationMenu` (Radix), the current one styled via its own
 * `active` prop rather than a hand-rolled span/link branch.
 * `print:hidden`: this has no place on the printed Flight Briefing
 * page, the one document this app ever produces that leaves the
 * browser.
 *
 * Which page is "active" comes from the route itself
 * (`useLocation().pathname`, basename-stripped by the router already)
 * rather than a prop every view had to pass down and keep in sync with
 * its own route.
 *
 * `trailing` is Shell's own `SidebarTrigger` -- only Plan/Label ever
 * have a sidebar to toggle, so this stays empty everywhere else rather
 * than every page needing to know about it.
 */
export default function PageHeader({ trailing }: { trailing?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 print:hidden">
      <Link to="/home" className="text-sm font-bold tracking-tight text-slate-900">
        VFR Route
      </Link>
      <div className="flex items-center gap-2">
        <NavigationMenu viewport={false}>
          <NavigationMenuList>
            {LINKS.map(link => (
              <NavigationMenuItem key={link.page}>
                <NavigationMenuLink asChild active={pathname === link.to}>
                  <Link to={link.to}>{link.label}</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
        {trailing}
      </div>
    </header>
  );
}
