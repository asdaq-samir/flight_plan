import type { ComponentProps } from "react";
import { ChevronLeft } from "lucide-react";
import RoundButton from "./RoundButton";

/**
 * A panel's way back, the close's twin at the owner's ask ("I want back
 * button like this and close button also similar", an iOS sheet's round
 * back button for the example): a RoundButton, its chevron drawn as the
 * close's cross is, at 24 with a thin line.
 */
export default function BackButton({ label = "Back", ...props }: Omit<ComponentProps<typeof RoundButton>, "label" | "children"> & {
  label?: string;
}) {
  return (
    <RoundButton label={label} {...props}>
      <ChevronLeft className="back-glyph size-6!" strokeWidth={1.7} />
    </RoundButton>
  );
}
