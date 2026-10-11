# The TV apps

Wingtip Maps on Samsung's TVs (Tizen) and LG's (webOS) is the site in the
TV's own web engine, as the phone apps are (`docs/IOS.md`,
`docs/ANDROID.md`). It is for planning on the big screen: the chart, the
route, the nav log, the weather and the brief.

## How they work

- **The app is one page** (`tv/shell/index.html`). It goes to the site
  with `?tv=tizen` or `?tv=webos` in the address. If the TV is offline, it
  says so and offers Try again, focused for the remote's OK.
- **The site makes itself for the remote** (`web/src/lib/tv.ts`):
  - **Scale.** It is drawn as at 1280 by 720, so on a 1920 screen
    everything is half again as large, to be read from the sofa. LG's app
    also asks for this (`resolution` in its `appinfo.json`).
  - **Arrows** move from control to control by where the controls are on
    the screen, with a thick ring in the tint showing where the remote
    is. This uses the W3C's spatial navigation, through its polyfill,
    which is loaded only on a TV.
  - **OK** presses the control.
  - **Back** closes what is open, as Escape does: a menu, a dialog, a
    card, then the panel lowered. With nothing open, it leaves the app.
  - **On the map**, the arrows pan it, and OK or channel up zooms in and
    channel down zooms out. The map's own + and − buttons are shown on a
    TV, for remotes without channel keys. Back takes the remote off the
    map.
- **Remote keys:** Samsung's Return is key 10009 and LG's Back is 461.
  LG's app takes Back itself (`disableBackHistoryAPI`). Neither app uses
  the TVs' own APIs: LG's `requiredACG` is empty, and Samsung's app asks
  only for the internet.
- **Sign-in** is the site's, by the emailed link. The link opens on the
  phone where the mail is read, not on the TV. Until there is a TV
  sign-in (owner issue), the TV plans signed out. Planning, charts,
  weather and the brief work signed out; saving flights and airplanes
  needs an account.
- **The TV has no GPS**, so own ship finds no position there.

## The build

`tv/package.sh`, run by `.github/workflows/tv.yml` on every change to
`tv/`:

- LG's app as `app.wingtipmaps.tv_<version>_all.ipk`, from the webOS
  CLI's `ares-package`. LG signs it when it is submitted.
- Samsung's app as `WingtipMaps-unsigned.wgt`, to be signed with your
  Samsung certificate.

Both are kept with the run (`wingtip-maps-tv`). The site's address comes
from the `WINGTIP_URL` variable, and Samsung's package id from
`TIZEN_PACKAGE`.

## What only the owner can do

### LG (webOS)

1. **Join LG's Seller Lounge** (seller.lgappstv.com), as a person or a
   company.
2. **Try it on a TV:**
   - install the Developer Mode app from the LG Content Store and sign in
     with the same LG account;
   - then, on a computer, add the TV with
     `npx --package=@webos-tools/cli ares-setup-device`, and install the
     `.ipk` with `ares-install`.
3. **Submit** the `.ipk` in the Seller Lounge, with:
   - a 400 × 400 icon (`docs/brand`);
   - screenshots;
   - the description and the privacy policy (the site's own).

### Samsung (Tizen)

1. **Join Samsung's Seller Office** (seller.samsungapps.com/tv), as a
   company (Samsung asks for one for TV apps). Note the package id it
   gives the app; set it as the repo variable `TIZEN_PACKAGE`.
2. **Make a Samsung certificate:**
   - install Tizen Studio and, in its Package Manager, the TV extension;
   - in the Certificate Manager, create a Samsung certificate with your
     Samsung account, its distributor certificate holding your TV's DUID
     for testing.
3. **Sign the widget:** import `tv/out/tizen` (or the run's widget) as a
   project in Tizen Studio and build it with that certificate, or run
   `tizen package -t wgt -s <profile> -- tv/out/tizen`.
4. **Try it on a TV:**
   - turn on Developer Mode in the TV's Apps panel (type 12345), giving
     your computer's address;
   - install with Tizen Studio's Device Manager.
5. **Submit** the signed widget in the Seller Office, with its icon,
   screenshots, the description and the privacy policy.

### Both

- **Sign-in on a TV.** Decide whether the TV signs in by a code shown on
  it and typed on a phone, as streaming apps do (the owner issue).
- **Leaving the app.** Check on a real TV that Back on the map's first
  screen leaves it. LG's webOS 6 and later ask first. For Samsung, the
  page uses `window.close()`, as the Tizen app API is not the site's.
  Samsung's review asks that Return on the first screen offers to leave.
