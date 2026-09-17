import {
  FlaskConical, ListChecks, MapPin, MoveRight, NotebookPen, PlaneTakeoff, Route, UserCircle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import Footer from "../../components/Footer";
import PageHeader from "../../components/PageHeader";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

interface LinkCard {
  href: string;
  icon: typeof Route;
  title: string;
  description: string;
}

const PAGES: LinkCard[] = [
  {
    href: "/app/plan",
    icon: Route,
    title: "Plan a route",
    description: "Two idents in, a charted course with scored checkpoints and a dead-reckoning nav log out. Includes the Flight Briefing page.",
  },
  {
    href: "/app/label",
    icon: ListChecks,
    title: "Label checkpoints",
    description: "Walk a corridor's candidates and rate how findable each one actually is from the air -- the training data the model learns from.",
  },
  {
    href: "/app/playground",
    icon: FlaskConical,
    title: "Playground",
    description: "How the served model was actually chosen, the full reasoning behind a recommended altitude, and live scoring from every algorithm this project has trained.",
  },
  {
    href: "/app/account",
    icon: UserCircle,
    title: "Account",
    description: "Sign in to manage your own aeroplanes and see the flights you've filed.",
  },
];

/** Departure/destination in, printable Flight Briefing out -- the
 *  actual pipeline every route walks through, in the same order the
 *  four page cards below cover it in depth. */
const STEPS: { icon: typeof MapPin; label: string }[] = [
  { icon: MapPin, label: "Pick two airports" },
  { icon: Route, label: "Charted course" },
  { icon: ListChecks, label: "Scored checkpoints" },
  { icon: NotebookPen, label: "Nav log + briefing" },
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
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <PlaneTakeoff className="size-8 text-primary" />
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
          Plan a real VFR cross-country, checkpoint by checkpoint
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Two airport idents in; a charted course, ML-scored visual checkpoints,
          a dead-reckoning nav log and a printable flight briefing out --
          backed by the same model this project trains on hand-labeled charts.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              {i > 0 && <MoveRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <s.icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PAGES.map(p => (
            <a key={p.href} href={p.href} className="block">
              <Card size="sm" className="h-full hover:bg-muted/50">
                <CardHeader>
                  <p.icon className="size-5 text-primary" aria-hidden />
                  <CardTitle>{p.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{p.description}</CardDescription>
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
