import { useCallback, useState } from "react";

/** Each card's tab picked, by the airport's own key. */
const kept = new Map<string, string>();

/**
 * The tab a card is on: the one picked for this airport while the page is
 * open, else the one it opens on (`initial`), else `fallback`.
 */
export function useCardTab<T extends string>(key: string, fallback: T, initial?: T | null): [T, (tab: T) => void] {
  const [picked, setPicked] = useState<T | null>(() => (kept.get(key) as T | undefined) ?? initial ?? null);
  const pick = useCallback((tab: T) => {
    kept.set(key, tab);
    setPicked(tab);
  }, [key]);
  return [picked ?? fallback, pick];
}
