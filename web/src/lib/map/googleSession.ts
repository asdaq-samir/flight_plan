import { useQuery } from "@tanstack/react-query";
import { googleMapsQuery } from "../queryClient";

/** Google's Map Tiles API: a session for a kind of map, then its tiles. */
export const GOOGLE = "https://tile.googleapis.com";

interface Session { session: string; expiry: number; key: string }

/**
 * A Google map session for a kind of map, kept in the browser until a day
 * before it runs out (two weeks, Google says): a session's tiles are one
 * set, asked for once rather than with every page. A session belongs to
 * the key that made it, so one made with another key (rotated since) is
 * not reused: Google refuses its tiles. The satellite's has
 * Google's roads and names over it, as its Satellite view does.
 */
async function googleSession(key: string, kind: "map" | "satellite"): Promise<Session> {
  const kept = `vfr.googleSession.${kind}`;
  try {
    const held = JSON.parse(localStorage.getItem(kept) ?? "null") as Session | null;
    if (held && held.key === key && held.expiry * 1000 - Date.now() > 24 * 3600_000) return held;
  } catch {
    // No storage: a new session.
  }
  const resp = await fetch(`${GOOGLE}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(kind === "map"
      ? { mapType: "roadmap", language: "en-US", region: "US", imageFormat: "png" }
      : { mapType: "satellite", language: "en-US", region: "US", layerTypes: ["layerRoadmap"] }),
  });
  if (!resp.ok) throw new Error(`Google's map session: ${resp.status}`);
  const answer = await resp.json() as { session: string; expiry: string };
  const session = { session: answer.session, expiry: Number(answer.expiry), key };
  try {
    localStorage.setItem(kept, JSON.stringify(session));
  } catch {
    // Kept for this page only.
  }
  return session;
}

/** Google's session for a kind of map, once the deployment's key is known;
 *  its error is for the settings to say (MapSettings). */
export function useGoogleSession(kind: "map" | "satellite", wanted = true) {
  const { data: google } = useQuery(googleMapsQuery);
  return useQuery({
    queryKey: ["googleSession", kind, google?.key], queryFn: () => googleSession(google!.key, kind),
    enabled: wanted && !!google, staleTime: 24 * 3600_000, meta: { silent: true },
  });
}
