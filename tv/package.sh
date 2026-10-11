#!/usr/bin/env bash
# The TV apps' packages (docs/TV.md), into tv/out: LG's webOS app as an
# .ipk (the webOS CLI's ares-package; LG signs it when it is submitted),
# and Samsung's Tizen app as a widget to sign (.wgt, zipped here; a
# Samsung certificate signs it in Tizen Studio, or `tizen package -t wgt
# -s <profile>` with the owner's own). Each holds the shell page
# (tv/shell) with the site's address and its platform written in.
#
#   WINGTIP_URL   the site, https://<domain>/app/plan (a stand-in before the domain)
#   TIZEN_PACKAGE Samsung's ten-character package id (a stand-in until Seller Office gives one)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
url="${WINGTIP_URL:-https://wingtipmaps.app/app/plan}"
host="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "$url")"
package="${TIZEN_PACKAGE:-WngtpMaps1}"
out="$here/out"
rm -rf "$out"
mkdir -p "$out/webos" "$out/tizen"

for platform in webos tizen; do
  cp "$here/shell/index.html" "$out/$platform/"
  printf 'window.WINGTIP_URL = %s;\nwindow.WINGTIP_TV = "%s";\n' \
    "$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$url")" "$platform" > "$out/$platform/site.js"
done
cp "$here/webos/appinfo.json" "$here/webos/icon.png" "$here/webos/largeIcon.png" "$here/webos/splash.png" "$out/webos/"
sed -e "s/__HOST__/$host/g" -e "s/__PACKAGE__/$package/g" "$here/tizen/config.xml" > "$out/tizen/config.xml"
cp "$here/tizen/icon.png" "$out/tizen/"

# LG: ares-package writes <id>_<version>_all.ipk.
npx --yes --package=@webos-tools/cli@3.2.6 ares-package "$out/webos" -o "$out" --no-minify
# Samsung: the widget's files at its root, unsigned.
(cd "$out/tizen" && python3 -m zipfile -c "$out/WingtipMaps-unsigned.wgt" config.xml index.html site.js icon.png)
ls -l "$out"
