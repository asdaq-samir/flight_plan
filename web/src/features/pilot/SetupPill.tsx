import { PillSection } from "../../components/Favorites";
import QuickControls from "../../components/QuickControls";

/**
 * Setup's pill: the Controls, the cockpit's four, alone -- the owner's pick
 * of the Setup canvas (2026-10-27, T3, "Controls first"): the half sheet
 * the cockpit's, big tiles for a hand in rough air; who is signed in and
 * their things under it, all the way up (PilotPanel). Setup's page starts
 * with this all the way up too, so a drag up only adds below.
 */
export default function SetupPill({ testId = "setup-pill" }: {
  /** Its own name where Setup's page starts with it all the way up. */
  testId?: string;
} = {}) {
  return (
    <div data-testid={testId}>
      <PillSection title="Controls" testId={`${testId}-controls`}>
        <QuickControls />
      </PillSection>
    </div>
  );
}
