# The iOS app

Wingtip Maps on the iPhone is a native shell round the deployed site
(Capacitor 8, `web/ios`, `web/capacitor.config.ts`). It loads the site
itself, so every deploy reaches the app at once, the session's cookies
are the site's own, and the service worker keeps the charts for the air
as it does in Safari. What the shell adds is the device:

- **Location** through iOS's own permission, with the app's reason
  (`NSLocationWhenInUseUsageDescription`), not a web view's second
  prompt (`@capacitor/geolocation`, `web/src/lib/native.ts`).
- **The share sheet** for a route (`@capacitor/share`).
- **Links open in the app.** The sign-in link tapped in Mail, or a shared
  route, opens the app rather than Safari (Associated Domains, and the
  webapp's `/.well-known/apple-app-site-association`), so signing in by
  email lands in the app's own session.
- The app icon and launch screen from `docs/brand`, and a privacy
  manifest (`PrivacyInfo.xcprivacy`) from `docs/privacy-inventory.md`.

In the app, sign-in is **Sign in with Apple, through iOS's own sheet**
(`@capacitor-community/apple-sign-in`): the app hands Apple's identity
token to the webapp, which checks its signature, issuer and audience
(this app's bundle id) and signs the pilot in, the same pilot the web's
Apple sign-in finds (`AppleNativeSignInController`). Or **the emailed
link**, which opens the app. Google refuses to sign in inside an app's
web view, so its button is the web's only; App Review needs none, and a
reviewer can sign in with their own Apple ID.

## The build

`.github/workflows/ios.yml`:

- **Every change to the app** is built for the simulator, unsigned, on
  GitHub's macOS runner (free for this public repository).
- **On `main`, once the key below exists,** the app is archived, signed
  by Xcode's cloud-managed signing with the App Store Connect key (no
  certificate or profile is kept anywhere), and uploaded to TestFlight.
  The build number is the workflow's run number.

## What only the owner can do

1. **Join the Apple Developer Program** ($99 a year) and note the Team
   ID (Membership details).
2. **Choose the bundle id**, e.g. `app.wingtipmaps.ios`; it cannot change
   once the app is in App Store Connect.
3. **Create the app in App Store Connect** (My Apps → +): the name, the
   bundle id (register it under Identifiers first, with the Associated
   Domains and Sign in with Apple capabilities), a SKU.
4. **Create an App Store Connect API key** (Users and Access →
   Integrations → App Store Connect API, role App Manager) and download
   its `.p8` once.
5. **In GitHub** (Settings → Secrets and variables → Actions):
   - variables `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `APP_STORE_KEY_ID`,
     `APP_STORE_ISSUER_ID`, and `WINGTIP_URL`
     (`https://<the domain>/app/plan`);
   - the secret `APP_STORE_KEY_P8`, the `.p8` file's contents.
6. **On the server**, add `APPLE_TEAM_ID` and `APP_IOS_BUNDLE_ID` to the
   stack's AppSecret (`infra/server/env.example`) and run `deploy.sh`,
   so the site names the app for its links and accepts its Apple
   sign-in.
7. **TestFlight:** add yourself as an internal tester. The next push to
   `main` that changes the app (or Run workflow on the iOS workflow)
   uploads a build; it appears in TestFlight after Apple processes it.
