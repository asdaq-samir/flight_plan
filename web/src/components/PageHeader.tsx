import { Link, useLocation } from "react-router-dom";
import { Settings } from "lucide-react";
import {
  NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList,
} from "./ui/navigation-menu";

const LINKS: { page: string; to: string; label: string; icon?: typeof Settings }[] = [
  { page: "plan", to: "/plan", label: "Plan" },
  { page: "dev", to: "/dev", label: "Dev" },
  { page: "settings", to: "/settings", label: "Settings", icon: Settings },
];

/**
 * The one piece of chrome every page shares -- "VFR Route" (linking to
 * Plan, the app's own homepage) on the left, the other two pages on
 * the right via shadcn's `NavigationMenu` (Radix), the current one
 * styled via its own `active` prop rather than a hand-rolled span/link
 * branch. Label isn't here -- it's linked from Dev instead (see that
 * page's own comment) rather than adding a fourth permanent item.
 * `print:hidden`: this has no place on the printed Flight Briefing
 * page, the one document this app ever produces that leaves the
 * browser.
 *
 * Settings renders as a bare gear icon (lucide's own `Settings`, no
 * separate hand-drawn glyph), not the word -- a settings page is
 * conventionally an icon in the community it's borrowed from (shadcn's
 * own examples, most app chrome generally), and the word sitting next
 * to "Plan" and "Dev" read as three peers when only one of them is
 * actually a settings page. `aria-label` carries the accessible name
 * an icon alone can't.
 *
 * Which page is "active" comes from the route itself
 * (`useLocation().pathname`, basename-stripped by the router already)
 * rather than a prop every view had to pass down and keep in sync with
 * its own route.
 */
export default function PageHeader() {
  const { pathname } = useLocation();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 print:hidden">
      <Link to="/plan" className="text-sm font-bold tracking-tight text-foreground">
        VFR Route
      </Link>
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          {LINKS.map(link => (
            <NavigationMenuItem key={link.page}>
              <NavigationMenuLink
                asChild
                active={pathname === link.to}
                className="data-[active]:bg-primary data-[active]:text-primary-foreground data-[active]:hover:bg-primary"
              >
                <Link to={link.to} aria-label={link.icon ? link.label : undefined}>
                  {link.icon ? <link.icon className="size-4" /> : link.label}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
    </header>
  );
}
