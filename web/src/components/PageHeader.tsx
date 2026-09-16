type Page = "home" | "plan" | "label" | "playground" | "account";

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "plan", href: "/app/plan", label: "Plan" },
  { page: "label", href: "/app/label", label: "Label" },
  { page: "playground", href: "/app/playground", label: "Playground" },
  { page: "account", href: "/app/account", label: "Account" },
];

/**
 * The one piece of chrome every page shares -- "VFR Route" (linking
 * home) on the left, the other three pages on the right, the current
 * one shown plain rather than as a link to itself. `print:hidden`:
 * this has no place on the printed Flight Briefing page, the one
 * document this app ever produces that leaves the browser.
 *
 * Plain `<a href>`s, not a router -- this project deliberately has
 * none (see web/README.md); every "navigation" here is a full page
 * load, the same as how Home's own links already worked before this
 * component existed.
 */
export default function PageHeader({ active }: { active: Page }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 print:hidden">
      <a href="/app" className="text-sm font-bold tracking-tight text-slate-900">
        VFR Route
      </a>
      <nav className="flex items-center gap-4 text-sm">
        {LINKS.map(link =>
          link.page === active ? (
            <span key={link.page} className="font-semibold text-slate-900">
              {link.label}
            </span>
          ) : (
            <a key={link.page} href={link.href} className="text-slate-500 hover:text-slate-900">
              {link.label}
            </a>
          ),
        )}
      </nav>
    </header>
  );
}
