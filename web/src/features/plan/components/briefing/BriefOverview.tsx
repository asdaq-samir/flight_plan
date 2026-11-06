import { useTabAsk, type PanelTab } from "../navlog/panelTab";
import AskSection from "../ask/AskCard";
import BriefGlance from "./BriefGlance";
import { NotamWords, RiskWords, WeatherWords } from "./BriefWords";
import FlightWatch from "./FlightWatch";

/**
 * The Brief as it opens (BriefCard's overview): the assistant's field
 * first -- the Brief is the AI's home -- then the verdict with the risk
 * picture in words under it, the four glance cards (BriefGlance, the
 * owner's D′), then the NOTAMs and the weather in words and the flight
 * watch. Nothing of the cards moves: the words and the watch are added
 * round them.
 */
export default function BriefOverview({ onOpen }: { onOpen: (tab: PanelTab) => void }) {
  // A words section's title opens its page as a glance card does -- the
  // panel all the way up -- and then its section by title (PanelTabs
  // hears the ask once the page is up).
  const open = (tab: PanelTab, section: string) => {
    onOpen(tab);
    useTabAsk.getState().go(tab, section);
  };
  return (
    <BriefGlance
      onOpen={onOpen}
      before={<AskSection />}
      afterVerdict={<RiskWords open={open} />}
      after={(
        <>
          <NotamWords open={open} />
          <WeatherWords open={open} />
          <FlightWatch />
        </>
      )}
    />
  );
}
