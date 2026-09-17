import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import Footer from "../../components/Footer";
import PageHeader from "../../components/PageHeader";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

interface LinkCard {
  href: string;
  title: string;
  description: string;
}

const PAGES: LinkCard[] = [
  {
    href: "/app/plan",
    title: "Plan a route",
    description: "Two idents in, a charted course with scored checkpoints and a dead-reckoning nav log out. Includes the Flight Briefing page.",
  },
  {
    href: "/app/label",
    title: "Label checkpoints",
    description: "Walk a corridor's candidates and rate how findable each one actually is from the air -- the training data the model learns from.",
  },
  {
    href: "/app/playground",
    title: "Playground",
    description: "How the served model was actually chosen, the full reasoning behind a recommended altitude, and live scoring from every algorithm this project has trained.",
  },
  {
    href: "/app/account",
    title: "Account",
    description: "Sign in to manage your own aeroplanes and see the flights you've filed.",
  },
];

/**
 * The front door -- reached by typing `/app` itself, or PageHeader's
 * own "VFR Route" link from anywhere else. Plan/Label/Playground/
 * Account each still work exactly as before at their own paths; this
 * is additive, not a replacement for "no router, one path check per
 * page" (see main.tsx).
 */
export default function HomeView() {
  useDocumentTitle("VFR Route");
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background">
      <PageHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <p className="text-sm text-muted-foreground">Pick a page.</p>
        <div className="mt-6 space-y-3">
          {PAGES.map(p => (
            <a key={p.href} href={p.href} className="block">
              <Card size="sm" className="hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{p.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
