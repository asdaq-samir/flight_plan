import { useQuery } from "@tanstack/react-query";
import { words } from "../../../../lib/api/words";
import { routeKeyOf, useBriefPlan } from "../../../../lib/briefPlan";
import { useVerdict, verdictLine } from "../../../../lib/verdict";
import { contextNow } from "../ask/useAsk";
import type { PanelTab } from "../navlog/panelTab";
import WordsSection from "./WordsSection";
import { wordsState } from "./wordsState";

/** The words are asked once for a route and its time, and kept: not on
 *  every render, and not again for ten minutes. */
const KEPT_MS = 10 * 60_000;

/** The way from a section's title to the list its words are drawn from:
 *  a page of the Brief and a section of it by its title (PanelTabs). */
export type OpenSection = (tab: PanelTab, section: string) => void;

/**
 * The Brief's three readings in words (WordsSection), under its verdict:
 * the risk picture -- the Go / No-Go read against the pilot's own
 * minimums and currency -- then, after the glance cards, the NOTAMs that
 * matter and the weather in words. Each is one billed call for a route
 * and its time (react-query, keyed by them), and each title opens the
 * list it was written from: the Risk Assessment, the TFRs (the NOTAMs
 * the Brief has in full) and the weather along the route.
 */
export function RiskWords({ open }: { open: OpenSection }) {
  const plan = useBriefPlan();
  const items = useVerdict(v => v.items);
  // Once every finding is in: the words of a verdict still waiting on the
  // weather would be asked again a moment later.
  const settled = items.length > 0 && !items.some(i => i.finding === "pending");
  const verdictKey = items.map(i => `${i.key}:${i.finding}`).join(",");
  const query = useQuery({
    queryKey: ["words", "risk", routeKeyOf(plan), verdictKey],
    queryFn: ({ signal }) => {
      const line = verdictLine(items);
      return words.risk({ verdict: { ...line, items: items.map(({ key, label, finding, detail }) => ({ key, label, finding, detail })) }, pilot: contextNow().pilot }, signal);
    },
    enabled: plan.routed && settled, staleTime: KEPT_MS, meta: { silent: true },
  });
  if (!plan.routed) return null;
  return <WordsSection title="Risk picture" testId="brief-risk-words" onMore={() => open("preflight", "Risk Assessment")} state={wordsState(query)} />;
}

export function NotamWords({ open }: { open: OpenSection }) {
  const plan = useBriefPlan();
  const query = useQuery({
    queryKey: ["words", "notams", routeKeyOf(plan)],
    queryFn: ({ signal }) => words.notams({ dep: plan.dep, dest: plan.dest, stops: plan.stops, depart: plan.depart || null }, signal),
    enabled: plan.routed && !!plan.dep && !!plan.dest, staleTime: KEPT_MS, meta: { silent: true },
  });
  if (!plan.routed) return null;
  // The Brief lists no NOTAMs in full but the TFRs, which are NOTAMs: the
  // title opens those.
  return <WordsSection title="NOTAMs that matter" testId="brief-notam-words" onMore={() => open("preflight", "TFRs & Special Use")} state={wordsState(query)} />;
}

export function WeatherWords({ open }: { open: OpenSection }) {
  const plan = useBriefPlan();
  const query = useQuery({
    // With the time en route and the legs once the nav log has them, as
    // the briefing itself is asked again then (usePlan).
    queryKey: ["words", "weather", routeKeyOf(plan), plan.eteMin, plan.legs?.fixes ?? null, plan.legs?.legMin ?? null],
    queryFn: ({ signal }) => words.weather({
      dep: plan.dep, dest: plan.dest, stops: plan.stops, depart: plan.depart || null,
      ete_min: plan.eteMin, fixes: plan.legs?.fixes ?? null, leg_min: plan.legs?.legMin ?? null,
    }, signal),
    enabled: plan.routed && !!plan.dep && !!plan.dest, staleTime: KEPT_MS, meta: { silent: true },
  });
  if (!plan.routed) return null;
  return <WordsSection title="The weather, in words" testId="brief-weather-words" onMore={() => open("enroute", "Along the Route")} state={wordsState(query)} />;
}
