import { Check } from "lucide-react";
import { cn } from "cn";

/** The box at the start of a row that is a checkbox (`role` checkbox on
 *  the row, the whole row the tap): ticked, filled in the tint, as iOS
 *  marks a chosen row. The risk assessment's and the preflight list's. */
export default function TickBox({ on }: { on: boolean }) {
  return (
    <span className={cn("flex size-5 items-center justify-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
      {on && <Check className="size-3.5" aria-hidden />}
    </span>
  );
}
