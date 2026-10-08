import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS app (ios/): a native shell round the deployed site, not a copy
 * of it. It loads WINGTIP_URL -- the production domain, /app/plan -- so
 * the session's cookies are the site's own, every deploy reaches the app
 * at once, and the service worker keeps charts for the air as it does in
 * Safari (Info.plist's WKAppBoundDomains lets a web view run one). What
 * the shell adds is the device: location through iOS's own permission
 * (@capacitor/geolocation, lib/native), the share sheet, and the sign-in
 * link opening in the app (Associated Domains, the webapp's
 * apple-app-site-association). `webDir` is required and holds only the
 * page shown if the site cannot be reached at all.
 */
const url = process.env.WINGTIP_URL ?? "https://wingtipmaps.app/app/plan";

const config: CapacitorConfig = {
  appId: process.env.WINGTIP_BUNDLE_ID ?? "app.wingtipmaps.ios",
  appName: "Wingtip Maps",
  webDir: "ios-offline",
  server: {
    url,
    // Navigation stays on the site; anything else opens in Safari.
    allowNavigation: [new URL(url).host],
    // The site cannot be reached on the very first open: webDir's page
    // says so, with a Try again.
    errorPath: "index.html",
  },
  ios: {
    // The map draws under the status bar and the home indicator, as the
    // site does in Safari (viewport-fit=cover, env(safe-area-inset-*)).
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
