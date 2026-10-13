import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Plane } from "lucide-react";
import { ListGroup, ListRow } from "../../components/GroupedList";
import QuickControls from "../../components/QuickControls";
import { shortName } from "../../lib/aircraftChoice";
import { usePreferences } from "../../lib/preferences";
import { pilotQuery } from "../../lib/queryClient";
import AccountRow from "./AccountRow";
import SignInModal from "./SignInModal";

/** A row's glyph on its own coloured square, as iPhone's Settings has. */
function Square({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`grid size-7 place-items-center rounded-[7px] text-white [&_svg]:size-4 ${className}`} aria-hidden="true">{children}</span>;
}

/**
 * Setup's pill, the owner's pick of the redesign (S3d, "it can have
 * aircraft and logbook"): who is signed in and the mode first, as
 * iPhone's Settings opens; then the airplanes and the logbook, each a row
 * that opens the console full on its page (`onOpen`); then the quick
 * switches in one row that slides sideways. Saved flights are FPL's now.
 * Signed out, the way in where the account would be.
 */
export default function SetupPill({ onOpen }: { onOpen: (page: "aircraft" | "logbook") => void }) {
  const { data: pilot } = useQuery(pilotQuery);
  const aircraft = usePreferences(s => s.aircraft);
  const rows = (
    <>
      <ListRow
        media={<Square className="bg-teal-600"><Plane /></Square>} title="Aircraft"
        value={aircraft.label ? shortName(aircraft.label) : undefined} chevron onClick={() => onOpen("aircraft")}
        data-testid="setup-aircraft"
      />
      <ListRow
        media={<Square className="bg-indigo-500"><NotebookPen /></Square>} title="Logbook" chevron onClick={() => onOpen("logbook")}
        data-testid="setup-logbook"
      />
    </>
  );
  // One group, as iPhone's Settings opens with you and your things: the
  // account, then the airplanes and the logbook under it.
  return (
    <div className="flex flex-col gap-2.5" data-testid="setup-pill">
      {pilot ? <AccountRow>{rows}</AccountRow> : (
        <ListGroup>
          <ListRow title="Not signed in">
            <SignInModal />
          </ListRow>
          {rows}
        </ListGroup>
      )}
      <QuickControls row />
    </div>
  );
}
