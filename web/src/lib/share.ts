import { useEffect, useState } from "react";
import { inNativeApp, nativeShare } from "./native";

/**
 * Something sent from the app -- a route's address, the flight for the
 * passengers -- the one way it goes everywhere: the share sheet in the
 * iOS and Android apps (lib/native) or where the browser has one (Safari
 * on an iPhone), otherwise copied. Says which, for the page to say so.
 */
export async function shareOrCopy(item: { title: string; text?: string; url?: string }): Promise<"shared" | "copied"> {
  if (inNativeApp()) {
    await nativeShare(item);
    return "shared";
  }
  if (navigator.share) {
    await navigator.share(item);
    return "shared";
  }
  await navigator.clipboard.writeText(item.url ?? item.text ?? "");
  return "copied";
}

/** The pilot closed the share sheet: nothing went wrong. */
export const cancelled = (err: unknown) => (err as Error | undefined)?.name === "AbortError";

/** "Copied" on what was copied, for a moment, where it was tapped: the
 *  key of what was, and the way to say another was. */
export function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const done = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(done);
  }, [copied]);
  return [copied, setCopied];
}
