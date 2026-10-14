import { useQuery } from "@tanstack/react-query";
import QuickControls from "../../components/QuickControls";
import { pilotQuery } from "../../lib/queryClient";
import AccountRow, { AccountLine } from "./AccountRow";
import SignInModal from "./SignInModal";

/**
 * Setup's pill: who is signed in and the mode, as iPhone's Settings opens,
 * on the pill's glass with no white strip under it (the owner's pick,
 * "Glass row"), over the quick switches in two rows, at the owner's ask
 * ("fit the setup icons in two rows since we have more space"). The
 * airplanes and the logbook are Setup's page, all the way up. Signed out,
 * Sign in where the mode would be.
 */
export default function SetupPill() {
  const { data: pilot } = useQuery(pilotQuery);
  return (
    <div className="flex flex-col gap-2" data-testid="setup-pill">
      {pilot ? <AccountRow glass /> : (
        <AccountLine name="Not signed in">
          <SignInModal plain />
        </AccountLine>
      )}
      <QuickControls />
    </div>
  );
}
