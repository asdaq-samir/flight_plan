import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { cn } from "cn";
import { Button } from "./ui/button";
import { reportOf, sendReport } from "../lib/errorReports";
import { TEXT } from "../lib/text";

/**
 * The page when a part of it could not be drawn -- most often a chunk the
 * phone could not fetch, after a deploy or with no signal (main.tsx's
 * vite:preloadError reloads once first) -- said plainly with the way on,
 * where the router's own error screen, a developer's, took the map's
 * place. Reported as a render error is.
 */
export default function PageError() {
  const error = useRouteError();
  useEffect(() => { sendReport(reportOf("render", error)); }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center" data-testid="page-error">
      <h1 className={cn("font-semibold text-foreground", TEXT.card)}>Part of the app didn’t load</h1>
      <p className={cn("max-w-sm text-muted-foreground", TEXT.detail)}>Check the connection, then reload.</p>
      <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
    </main>
  );
}
