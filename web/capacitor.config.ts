import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS and Android apps (ios/, android/): a native shell round the
 * deployed site, not a copy of it. It loads WINGTIP_URL -- the production domain, /app/plan -- so
 * the session's cookies are the site's own, every deploy reaches the app
 * at once, and the service worker keeps charts for the air as it does in
 * Safari (Info.plist's WKAppBoundDomains lets a web view run one). What
 * the shell adds is the device: location through the system's own
 * permission (@capacitor/geolocation, lib/native), the share sheet, and
 * the sign-in link opening in the app (iOS's Associated Domains and the
 * webapp's apple-app-site-association; Android's App Links and its
 * assetlinks.json). `webDir` is required and holds only the page shown if
 * the site cannot be reached at all. Android's package name, version and
 * signing are its Gradle build's (android/app/build.gradle), not this
 * file's: `appId` here is iOS's bundle id.
 */
const url = process.env.WINGTIP_URL ?? "https://wingtipmaps.app/app/plan";

// The offline page is served from the app bundle, so its Try again cannot
// reload itself: it has to go to the site, whose address is WINGTIP_URL.
// `cap sync` reads this file before it copies webDir, so the page is
// given the address there (ios-offline/site.js, not committed).
// Node's own fs, asked for at run time: an import here would be compiled
// by the Capacitor CLI into a require() that this ES-module package
// refuses ("exports is not defined"). The CLI runs from web/.
process.getBuiltinModule("node:fs").writeFileSync(
  `${process.cwd()}/ios-offline/site.js`,
  `window.WINGTIP_URL = ${JSON.stringify(url)};\n`,
);

const config: CapacitorConfig = {
  appId: process.env.WINGTIP_BUNDLE_ID ?? "app.wingtipmaps.ios",
  appName: "Wingtip Maps",
  webDir: "ios-offline",
  server: {
    url,
    // Navigation stays on the site; anything else opens in Safari.
    allowNavigation: [new URL(url).host],
    // The site cannot be reached on the very first open: webDir's page
    // says so, with a Try again that goes to the site.
    errorPath: "index.html",
  },
  ios: {
    // The map draws under the status bar and the home indicator, as the
    // site does in Safari (viewport-fit=cover, env(safe-area-inset-*)).
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    // Apple's sign-in sheet is iOS's (lib/native): left out of Android's
    // build.
    includePlugins: ["@capacitor/app", "@capacitor/geolocation", "@capacitor/share"],
  },
  plugins: {
    SystemBars: {
      // On Android too the map draws edge to edge, under the status and
      // navigation bars, the site's own viewport-fit=cover and
      // env(safe-area-inset-*) keeping its controls clear of them; an
      // older Chromium (before 140) has the web view padded instead.
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
