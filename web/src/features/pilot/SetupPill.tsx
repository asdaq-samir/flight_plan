import { Suspense, lazy, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { PillSection } from "../../components/Favorites";
import QuickControls from "../../components/QuickControls";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import { AccountMenu } from "./AccountMenu";
import { TAB_PAGE_GAP } from "../../components/TabPage";

// Loaded when it is drawn, as PaidPrompt does: imported here it put the
// sign-in sheet in the first load for every pilot already signed in.
const SignInModal = lazy(() => import("./SignInModal"));

/**
 * Setup's pill: the quick switches in two rows under their title,
 * Controls, then Account -- the mode at the title's right, the address
 * under it, not in a table ("Email doesn't need to be in the table") -- at the
 * owner's asks ("Label the top as controls"; "setup can show the account
 * section with the email and then expanded starts showing everything
 * after that"). All the way up Setup's page starts with this, the
 * account's group going on with the airplanes, the flights, the logbook
 * and the minimums (`rows`), so a drag up only adds below. Signed out,
 * the way in where the account would be.
 */
export default function SetupPill({ testId = "setup-pill", rows }: {
  /** Its own name where Setup's page starts with it all the way up. */
  testId?: string;
  /** The Account's group under the address, all the way up. */
  rows?: ReactNode;
} = {}) {
  const { data: pilot } = useQuery(pilotQuery);
  return (
    // Its sections as far apart as the page's others (TabPage).
    <div className={cn("flex flex-col", TAB_PAGE_GAP)} data-testid={testId}>
      <PillSection title="Controls" testId={`${testId}-controls`}>
        <QuickControls />
      </PillSection>
      <PillSection
        title="Account" testId={`${testId}-account`}
        right={<>{!pilot && <Suspense fallback={null}><SignInModal plain /></Suspense>}<AccountMenu /></>}
      >
        {/* Who is signed in is the role menu's title (AccountMenu). */}
        {!pilot && <p className={cn("truncate text-muted-foreground", TEXT.row)}>Not signed in</p>}
        {rows && <div className="flex justify-between gap-2 pt-1" data-testid="library-section">{rows}</div>}
      </PillSection>
    </div>
  );
}
