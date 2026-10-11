/**
 * The iOS and Android apps' shell (Capacitor, capacitor.config.ts): the
 * site in a web view, with the device's own location, share sheet and
 * links. In Safari or any other browser none of this runs: the shell
 * injects window.Capacitor, and the plugins are imported only when it is
 * there, so the site's own first load carries none of them.
 */

import { closeTopmost } from "./back";

interface CapacitorGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string }
const capacitor = () => (window as { Capacitor?: CapacitorGlobal }).Capacitor;

/** Whether this page is running in the iOS or the Android app. */
export function inNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** Which app this page is running in, or null in a browser. */
export function nativePlatform(): "ios" | "android" | null {
  if (!inNativeApp()) return null;
  const platform = capacitor()?.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

/** A position as the browser's Geolocation gives one: the plugin's has the same shape. */
export interface NativePosition {
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null;
    altitude: number | null };
  timestamp: number;
}

/**
 * Own ship's fixes through the device's location, asked for with the
 * app's own permission sheet (iOS's Info.plist reason, Android's
 * permission dialog) rather than the web view's second prompt for the
 * site. Answers a function that stops watching.
 */
export async function watchNativePosition(onFix: (position: NativePosition) => void,
  onError: (message: string, refused: boolean) => void): Promise<() => void> {
  const { Geolocation } = await import("@capacitor/geolocation");
  try {
    const status = await Geolocation.requestPermissions({ permissions: ["location"] });
    if (status.location === "denied") {
      onError("Location access was refused; allow it for Wingtip Maps in Settings.", true);
      return () => {};
    }
  } catch {
    // Location services off for the whole device: watchPosition says so.
  }
  const id = await Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    (position, err) => {
      if (err || !position) onError(err?.message ?? "No position yet.", false);
      else onFix(position);
    });
  return () => void Geolocation.clearWatch({ id });
}

/** The share sheet, from the app. */
export async function nativeShare(title: string, url: string): Promise<void> {
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, url });
}

/**
 * A link to the site tapped elsewhere -- the sign-in link in Mail, a
 * shared route in Messages -- opens the app (iOS's Associated Domains
 * and the webapp's apple-app-site-association; Android's App Links and
 * its assetlinks.json), which then goes there: the sign-in lands in the
 * app's own session.
 */
export async function followAppLinks(): Promise<void> {
  const { App } = await import("@capacitor/app");
  const follow = (url: string) => {
    try {
      if (new URL(url).origin === window.location.origin) window.location.assign(url);
    } catch {
      // Not a URL: nothing to follow.
    }
  };
  await App.addListener("appUrlOpen", ({ url }) => follow(url));
  // Android gives a link that started the app to getLaunchUrl, not to
  // appUrlOpen (which is for an app already running): the emailed
  // sign-in link is usually tapped with the app closed.
  const launch = await App.getLaunchUrl();
  if (launch?.url) follow(launch.url);
}

/**
 * Android's back, the gesture or the button: the topmost thing open
 * closed (lib/back), and with nothing left to close the app put away, as
 * Android's own apps are from their first screen.
 */
export async function followBackButton(): Promise<void> {
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!closeTopmost()) void App.minimizeApp();
  });
}

/**
 * Sign in with Apple through the app's own sheet: Apple's identity token
 * for this app, which the webapp checks and signs the pilot in with
 * (AppleNativeSignInController). Answers it, or null when the pilot
 * closed the sheet.
 */
export async function nativeAppleIdentityToken(): Promise<string | null> {
  const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
  try {
    // clientId and redirectURI are the web flow's; the native sheet uses neither.
    const { response } = await SignInWithApple.authorize({ clientId: "", redirectURI: "", scopes: "email name" });
    return response.identityToken;
  } catch (err) {
    // ASAuthorizationError 1001: the pilot cancelled.
    if (String((err as Error)?.message ?? err).includes("1001")) return null;
    throw err;
  }
}

