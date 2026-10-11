# The Android app

Wingtip Maps on Android is the same native shell as the iPhone's
(`docs/IOS.md`): Capacitor 8 (`web/android`, `web/capacitor.config.ts`)
round the deployed site, which it loads itself, so every deploy reaches
the app at once, the session's cookies are the site's own, and the
service worker keeps the charts for the air as it does in Chrome. What
the shell adds is the device:

- **Location** through Android's own permission dialog, asked for when
  the pilot turns own ship on, while the app is open only
  (`@capacitor/geolocation`, `web/src/lib/native.ts`).
- **The share sheet** for a route (`@capacitor/share`).
- **Links open in the app.** The sign-in link tapped in Gmail, or a
  shared route, opens the app rather than Chrome (App Links, verified
  against the webapp's `/.well-known/assetlinks.json`,
  `AssetLinksController`), so signing in by email lands in the app's own
  session.
- **Back** -- the gesture or the button -- closes what is open, as
  Escape does on the site: a menu, a dialog, a card, then the panel
  lowered; with nothing open it puts the app away.
- **Edge to edge**: the map under the status and navigation bars, its
  controls clear of them (Capacitor's SystemBars, the site's own safe
  areas).
- The launcher icon from `docs/brand` (`android-*.svg`: the chart behind,
  the mark in front, and the mark alone for Android 13's themed icons),
  and the launch screen as the iPhone's.

In the app, sign-in is **the emailed link**, which opens the app. Google
refuses to sign in inside an app's web view, and Sign in with Apple's
sheet is iOS's, so neither button shows on Android.

## The build

`.github/workflows/android.yml`:

- **Every change to the app** is built on GitHub's Linux runner into a
  debug APK, kept with the run for 14 days (the run's artifacts,
  `wingtip-maps-debug-apk`): it installs on any Android phone with
  "Install unknown apps" allowed for the browser or Files.
- **On `main`, once the owner has set up Google Play below,** a release
  bundle is built, signed with the owner's upload key, kept with the run
  (`wingtip-maps-release-aab`) and sent to Google Play's internal testing
  track (`.github/android/play_upload.py`, through the Google Play
  Developer API with the owner's service account). The version code is
  the workflow's run number.

The package name, the site's address and the signing come into the
Gradle build from outside (`web/android/app/build.gradle`): nothing of
the owner's is kept in the repository.

## What only the owner can do

1. **Open a Google Play developer account** (play.google.com/console,
   $25 once) and verify your identity. A new *personal* account must run
   a closed test with at least 12 testers for 14 days before it can
   publish to everyone; an *organization* account (it needs a D-U-N-S
   number) need not.
2. **Choose the package name**, e.g. `app.wingtipmaps.android`; it
   cannot change once the app is on Google Play.
3. **Create the app in the Play Console** (Create app): its name,
   language, app (not game), free.
4. **Make an upload key**, and keep it and its password in your password
   manager (Google Play can reset a lost one, but it takes days):

   ```sh
   keytool -genkeypair -v -keystore upload.jks -alias upload \
     -keyalg RSA -keysize 4096 -validity 10000
   base64 -i upload.jks | pbcopy   # the secret below, on a Mac
   ```

5. **Give the workflow Google Play's API.** In Google Cloud, a project
   with the *Google Play Android Developer API* enabled, a service
   account in it, and a JSON key for that account. In the Play Console,
   Users and permissions → Invite new users: the service account's
   address, with *Release apps to testing tracks* for this app.
6. **In GitHub** (Settings → Secrets and variables → Actions):
   - the variable `ANDROID_APP_ID`, the package name (it is what turns
     the upload on), and `WINGTIP_URL` if it is not set yet
     (`https://<the domain>/app/plan`);
   - the secrets `ANDROID_UPLOAD_KEYSTORE` (the base64 of `upload.jks`),
     `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, and `PLAY_SERVICE_ACCOUNT_JSON`
     (the JSON key's contents);
   - optionally `ANDROID_UPLOAD_KEY_ALIAS` if the key's alias is not
     `upload`, and `PLAY_TRACK` for a track other than `internal`.
7. **The first bundle, by hand.** Google Play takes an app's very first
   bundle only through the Console: run the Android workflow on `main`
   (Actions → Android → Run workflow), download the run's
   `wingtip-maps-release-aab`, and upload it under Test and release →
   Testing → Internal testing → Create new release, accepting Play App
   Signing. Add yourself as a tester and roll it out. The run's own
   upload fails until then; that is expected.
8. **Then every build goes up by itself.** Set the variable
   `PLAY_RELEASE_STATUS` to `completed` once the first release is rolled
   out (until then Google Play takes drafts only), and each push to
   `main` that changes the app is on the internal track for testers.
9. **On the server**, add `APP_ANDROID_PACKAGE` (the package name) and
   `APP_ANDROID_CERT_SHA256` to the stack's AppSecret
   (`infra/server/env.example`) and run `deploy.sh`: the SHA-256
   fingerprints, comma-separated, of the app signing key and the upload
   key (Play Console, Test and release → App integrity → App signing).
   Links then open in the app; Android checks
   `https://<the domain>/.well-known/assetlinks.json` when the app is
   installed.
10. **The store listing and its forms**: the description, screenshots,
    the content rating questionnaire, and the Data safety form, whose
    answers are in `docs/privacy-inventory.md` (location, precise, for
    app functionality; no data shared for advertising).
