import { useContext, type ReactNode } from "react";
import { cn } from "cn";
import AboutPanel from "./AboutPanel";
import { ConsoleInPanelContext, ConsoleSettingsContext } from "./mapChrome";
import { LineTabsList } from "./CardTabs";
import { Tabs, TabsContent, TabsTrigger } from "./ui/tabs";
import { LINE_TAB } from "./lineTabs";

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
 * settings and then About are the last tabs of either, from the page
 * (MapPage), so they are one tap from wherever the console is.
 */
export default function ConsoleTabs({ tabs: own, saved, onChange }: Props) {
  const settings = useContext(ConsoleSettingsContext);
  // On a phone, the map panel's layer under its tab bar: its tabs start
  // four points down, where the other tabs' search bars do, at the
  // owner's notice ("Why do the tabs within their setup seem lower than
  // other cards?"); they were sixteen down, the sheet's own margin.
  const inPanel = useContext(ConsoleInPanelContext) !== null;
  // About after Settings, as iOS keeps an app's About with its settings.
  const tabs: ConsoleTab[] = settings
    ? [...own, { value: "settings", label: "Settings", content: settings }, { value: "about", label: "About", content: <AboutPanel /> }]
    : own;
  const tab = tabs.some(t => t.value === saved) ? saved : own[0].value;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto max-w-3xl p-4", inPanel && "pt-1")}>
        <Tabs value={tab} onValueChange={onChange}>
          {/* The tabs as words over a hairline, the chosen one in the
              tint and underlined in it: the stock line variant (ui/tabs).
              They were a segmented control, a grey track with the chosen
              one raised, and read as one more of Settings' pick-one
              controls (Theme, Layout, Chart) -- which choose a value,
              where these change the page. The column's width, the tabs
              equal (each trigger is flex-1); 44 tall to a finger, which
              no box shows, the words 15 to it -- 13, and closer, in
              Slide Over's 320, where the developer's four at 15 ran
              past the column's margins. (The System tab's
              refresh, which sat on a line under them, is the tab's last
              row now.) */}
          {/* A bar, 44 tall to a finger as iOS's tab bars are: its tabs
              share it edge to edge, so the bar is their hit area. */}
          <LineTabsList>
            {tabs.map(t => (
              <TabsTrigger
                key={t.value} value={t.value}
                className={LINE_TAB}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </LineTabsList>
          {tabs.map(t => (
            <TabsContent key={t.value} value={t.value} className="mt-3">{t.content}</TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
