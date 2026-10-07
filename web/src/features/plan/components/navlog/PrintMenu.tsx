import { Printer } from "lucide-react";
import RoundButton from "../../../../components/RoundButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../../components/ui/dropdown-menu";
import { printKneeboard } from "../../../../lib/printKneeboard";

/**
 * Print, a round button of glass at the end of the panel's row beside
 * Save and Share, as the route's close and the console's are (the pilot's
 * ask, splitting the More that held both): the whole briefing, or the
 * kneeboard card -- the nav log, radio and patterns on one half-letter
 * page to fly with. Printed once the menu has gone, so it is not on the
 * paper.
 */
export default function PrintMenu({ disabled = false }: { disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <RoundButton label="Print" className="print:hidden" data-testid="print-button">
          <Printer className="size-5" strokeWidth={2} />
        </RoundButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="print:hidden">
        <DropdownMenuItem onSelect={() => setTimeout(() => window.print(), 150)} data-testid="print-briefing"><Printer />The briefing</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTimeout(printKneeboard, 150)} data-testid="print-kneeboard"><Printer />A kneeboard card</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
