import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface ConsoleTab {
  value: string;
  label: string;
  content: ReactNode;
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
  /** Whatever else belongs on the tab row, left of the theme toggle --
   *  the developer's refresh button, the pilot's sign-in status. */
  actions?: ReactNode;
}

/**
 * Both consoles that drop down over the map: the developer's and the
 * pilot's. One thing per tab rather than everything in one long
 * scroll, the tab row sharing its line with the theme toggle and
 * whatever else that console offers, and the whole thing centred on a
 * readable column. Only the tabs and those actions differ between the
 * two, so only those are props.
 */
export default function ConsoleTabs({ tabs, saved, onChange, actions }: Props) {
  const tab = tabs.some(t => t.value === saved) ? saved : tabs[0].value;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={onChange}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
            </TabsList>
            {/* Held to the row's width and wrapping within it: signed in,
                "Signed in as <address>" and Log out share this row with
                the developer's own status and buttons, and at a phone's
                width they ran off the right edge of the screen. The
                address truncates rather than pushing the rest out. */}
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
              {actions}
              <ThemeToggle />
            </div>
          </div>
          {tabs.map(t => (
            <TabsContent key={t.value} value={t.value} className="mt-3">{t.content}</TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
