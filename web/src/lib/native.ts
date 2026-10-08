/**
 * The iOS app's shell (Capacitor, capacitor.config.ts): the site in a
 * web view, with the device's own location, share sheet and links. In
 * Safari or any other browser none of this runs: the shell injects
 * window.Capacitor, and the plugins are imported only when it is there,
 * so the site's own first load carries none of them.
 */

/** Whether this page is running in the iOS app. */
export function inNativeApp(): boolean {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/** A position as the browser's Geolocation gives one: the plugin's has the same shape. */
export interface NativePosition {
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null;
    altitude: number | null };
  timestamp: number;
}

/**
 * Own ship's fixes through iOS's location, asked for with the app's own
 * permission sheet (Info.plist's reason) rather than the web view's
 * second prompt for the site. Answers a function that stops watching.
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
 * shared route in Messages -- opens the app (Associated Domains, the
 * webapp's apple-app-site-association), which then goes there: the
 * sign-in lands in the app's own session.
 */
export async function followAppLinks(): Promise<void> {
  const { App } = await import("@capacitor/app");
  await App.addListener("appUrlOpen", ({ url }) => {
    try {
      if (new URL(url).origin === window.location.origin) window.location.assign(url);
    } catch {
      // Not a URL: nothing to follow.
    }
  });
}
