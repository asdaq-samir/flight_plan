import { useContext, type ReactNode } from "react";
import { ConsoleSettingsContext } from "./mapChrome";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface ConsoleTab {
  value: string;
  /** The tab's name, and whatever badge it carries beside it. */
  label: ReactNode;
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
}

/**
 * Both consoles: the developer's and the pilot's. One thing per tab
 * rather than everything in one long scroll, the tabs across the
 * column, and the whole thing centred on a readable column. Only the
 * tabs differ between the two, so only those are props; who is signed
 * in is the sheet's own header (ConsoleHeader), above both. The
 * settings are the last tab of either, from the page (MapPage), so they
 * are one tap from wherever the console is.
 */
export default function ConsoleTabs({ tabs: own, saved, onChange }: Props) {
  const settings = useContext(ConsoleSettingsContext);
  const tabs: ConsoleTab[] = settings ? [...own, { value: "settings", label: "Settings", content: settings }] : own;
  const tab = tabs.some(t => t.value === saved) ? saved : own[0].value;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={onChange}>
          {/* The tabs as iOS's segmented control: the column's width,
              its segments equal (each trigger is flex-1), 32 points tall,
              the chosen one raised 2 in from the track, the words 13
              (ui/tabs). It was as wide as its words, and each tab as
              wide as its own. (The System tab's refresh, which sat on a
              line under them, is the tab's last row now.) */}
          <TabsList className="w-full p-0.5 group-data-[orientation=horizontal]/tabs:h-8">
            {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          </TabsList>
          {tabs.map(t => (
            <TabsContent key={t.value} value={t.value} className="mt-3">{t.content}</TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
