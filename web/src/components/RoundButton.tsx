import type { ComponentProps } from "react";
import { cn } from "cn";
import IconButton from "./IconButton";
import { ROUND_BUTTON } from "./mapChrome";

/**
 * A round pane of glass on the map's panel, as Maps' buttons are on iOS
 * 26 -- the console's gear, every panel's close (CloseButton), Nearest,
 * Save, Share and Print, an airport's star: 36 points with a finger's 44
 * round it (index.css), its glyph bold in the text's colour, the glyph
 * the caller's at 20 (`size-5`), one look and size in every panel, at
 * the pilot's ask. An IconButton, so its label is its tooltip and its
 * name, and it composes as one does (a menu's or a sheet's trigger).
 */
export default function RoundButton({ className, ...props }: ComponentProps<typeof IconButton>) {
  return <IconButton variant="secondary" className={cn("size-9 shrink-0", ROUND_BUTTON, className)} {...props} />;
}
