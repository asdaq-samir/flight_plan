"""Sends the Android app's release bundle to a Google Play track.

Run by .github/workflows/android.yml on main, once the owner has set up
Google Play (docs/ANDROID.md): one edit of the app's listing with the
bundle uploaded and put on the track, committed. Through the Google Play
Developer API itself, with the owner's service account, rather than a
third party's action holding that key.

    python play_upload.py BUNDLE PACKAGE TRACK STATUS

The service account's JSON key is in PLAY_SERVICE_ACCOUNT_JSON. STATUS is
"draft" until the app's first release has been rolled out in the Play
Console (Play refuses any other on an app not yet published), then
"completed".
"""

import json
import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"


def main(bundle: str, package: str, track: str, status: str) -> None:
    key = json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"])
    session = AuthorizedSession(service_account.Credentials.from_service_account_info(key, scopes=[SCOPE]))

    def answer(response):
        # Play's own words on a refusal: the package not yet created in
        # the Console, a version code already used, a status not allowed.
        if not response.ok:
            sys.exit(f"Google Play refused {response.request.method} {response.url.split('?')[0]}: "
                     f"{response.status_code} {response.text[:800]}")
        return response.json()

    edit = answer(session.post(f"{API}/{package}/edits", json={}))["id"]
    with open(bundle, "rb") as file:
        uploaded = answer(session.post(
            f"{UPLOAD}/{package}/edits/{edit}/bundles", params={"uploadType": "media"},
            data=file, headers={"Content-Type": "application/octet-stream"}, timeout=900))
    version = str(uploaded["versionCode"])
    answer(session.put(f"{API}/{package}/edits/{edit}/tracks/{track}", json={
        "track": track, "releases": [{"versionCodes": [version], "status": status}]}))
    answer(session.post(f"{API}/{package}/edits/{edit}:commit"))
    print(f"Version {version} of {package} is on Google Play's {track} track ({status}).")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
