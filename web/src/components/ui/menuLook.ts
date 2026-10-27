import { MATERIAL } from "../mapChrome";
import { TEXT } from "../../lib/text";

/**
 * iOS's menu, for every menu the app opens -- a pull-down's choices
 * (PullDown), an action menu (dropdown-menu) and a held row's (context-menu)
 * -- one look, where each had shadcn's small grey box: a 14-point corner
 * on the light material, the map blurred through it, rows edge to edge
 * with a hairline between them and a wider grey band between groups.
 */
export const MENU_CONTENT = `min-w-56 rounded-[14px] p-0 shadow-xl ring-1 ring-foreground/10 ${MATERIAL}`;

/** A row: 44 points to a finger, as iOS's menus' rows and the grouped
 *  lists' are (GroupedList), a row's words (TEXT.row), and the hairline
 *  over it but for the first and one after a group's band or heading.
 *  The row is the control, its own height its hit area. */
export const MENU_ITEM = `relative flex cursor-default items-center gap-2 rounded-none px-4 py-2 pointer-coarse:min-h-11 outline-hidden select-none border-t border-foreground/10 first:border-t-0 [[data-slot$=separator]+&]:border-t-0 [[data-slot$=label]+&]:border-t-0 focus:bg-foreground/8 data-highlighted:bg-foreground/8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${TEXT.row}`;

/** A picked-one row (radio or checkbox): its checkmark on the left, as
 *  iOS puts it, the words lined up whether or not it is ticked. */
export const MENU_CHECK_ITEM = `${MENU_ITEM} pl-10`;

/** Where the checkmark sits in such a row. */
export const MENU_CHECK = "pointer-events-none absolute left-3.5 flex size-4 items-center justify-center text-foreground";

/** Between groups: iOS's band, not a line. */
export const MENU_SEPARATOR = "mx-0 my-0 h-2 bg-foreground/8";

/** A group's heading in a menu. */
export const MENU_LABEL = `px-4 pt-2 pb-1 font-medium text-muted-foreground ${TEXT.note}`;
