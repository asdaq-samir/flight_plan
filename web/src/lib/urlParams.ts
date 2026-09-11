/**
 * Query params without a router. The URL is the only state here that
 * needs to survive a reload, and there are never more than three keys.
 */

export function getParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

export function setParams(params: Record<string, string>): void {
  const usp = new URLSearchParams(params);
  window.history.replaceState(null, "", `?${usp.toString()}`);
}
