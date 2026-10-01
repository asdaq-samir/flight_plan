import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface ConsoleTab {
  value: string;
  /** The tab's name, and whatever badge it carries beside it. */
  label: ReactNode;
  content: ReactNode;
  /** Icon buttons that belong to this tab alone, shown at the row's
   *  right-hand end while it is open -- the System tab's refresh. */
  buttons?: ReactNode;
}

interface Props {
  /** At least one -- a console with no tabs has nothing to fall back
   *  to, so the type says so rather than the code checking for it. */
  tabs: [ConsoleTab, ...ConsoleTab[]];
  /** The tab this console was last on, remembered per browser. A value
   *  that no longer names a tab falls back to the first one, so a
   *  renamed or dropped tab can't leave the console blank. */
  saved: string;
  onChange: (value: string) => void;
  /** A last line under whichever tab is open -- when the developer's
   *  snapshot was checked. */
  footer?: ReactNode;
}

/**
 * Both consoles that drop down over the map: the developer's and the
 * pilot's. One thing per tab rather than everything in one long
 * scroll, the tabs across the column with whatever buttons the open
 * tab brings with it under them (the theme is in the header's
 * settings), and the whole thing centred on a readable column. Only
 * the tabs differ between the two, so only those are props; who is
 * signed in is the sheet's own header (ConsoleHeader), above both.
 */
export default function ConsoleTabs({ tabs, saved, onChange, footer }: Props) {
  const tab = tabs.some(t => t.value === saved) ? saved : tabs[0].value;
  const open = tabs.find(t => t.value === tab) ?? tabs[0];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={onChange}>
          {/* The tabs as iOS's segmented control: the column's width,
              its segments equal (each trigger is flex-1), 32 points tall,
              the chosen one raised 2 in from the track, the words 13
              (ui/tabs). It was as wide as its words, and each tab as
              wide as its own. A tab's own buttons (the System tab's
              refresh) on a line under it, at the right. */}
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="w-full p-0.5 group-data-[orientation=horizontal]/tabs:h-8">
              {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
            </TabsList>
            {open.buttons && <div className="ml-auto flex items-center gap-1">{open.buttons}</div>}
          </div>
          {tabs.map(t => (
            <TabsContent key={t.value} value={t.value} className="mt-3">{t.content}</TabsContent>
          ))}
        </Tabs>
        {footer}
      </div>
    </div>
  );
}
