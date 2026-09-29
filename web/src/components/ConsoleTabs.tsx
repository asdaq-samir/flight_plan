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
  /** Icon buttons that sit with the tabs, before the theme toggle --
   *  the developer's refresh. */
  buttons?: ReactNode;
  /** Whatever else belongs on the tab row and may wrap under it -- the
   *  sign-in status. */
  actions?: ReactNode;
  /** A last line under whichever tab is open -- when the developer's
   *  snapshot was checked. */
  footer?: ReactNode;
}

/**
 * Both consoles that drop down over the map: the developer's and the
 * pilot's. One thing per tab rather than everything in one long
 * scroll, the tab row sharing its line with the theme toggle and
 * whatever else that console offers, and the whole thing centred on a
 * readable column. Only the tabs and those actions differ between the
 * two, so only those are props.
 */
export default function ConsoleTabs({ tabs, saved, onChange, buttons, actions, footer }: Props) {
  const tab = tabs.some(t => t.value === saved) ? saved : tabs[0].value;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={onChange}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* The tabs and the buttons as one group, so the buttons are
                where the tabs are on every width; they used to sit at
                the row's far end, and on a phone that was a line of
                their own under the sign-in status. */}
            <div className="flex items-center gap-1">
              <TabsList>
                {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
              </TabsList>
              {buttons}
              <ThemeToggle />
            </div>
            {/* Held to the row's width and wrapping within it: signed in,
                "Signed in as <address>" and Log out share this row, and at
                a phone's width they ran off the right edge of the screen.
                The address truncates rather than pushing the rest out. */}
            {actions && (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
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
