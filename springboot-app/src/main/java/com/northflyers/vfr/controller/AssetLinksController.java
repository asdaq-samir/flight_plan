package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Hidden;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The file Android reads to open links to this site in the Android app
 * (its App Links, web/android): the sign-in link a pilot taps in Gmail
 * lands in the app's own session, and a shared route opens there, as
 * apple-app-site-association does for iOS. Android fetches it from
 * /.well-known/ when the app is installed, over HTTPS with no redirect,
 * and trusts the app only if one of the certificates named here signed it.
 *
 * <p>Named by APP_ANDROID_PACKAGE and APP_ANDROID_CERT_SHA256 -- the
 * SHA-256 fingerprints of the certificates that sign the app, comma
 * separated: Google Play's app signing key (Play Console, App integrity)
 * and the upload key, whose builds a tester installs by hand. With either
 * missing there is no app to name, and this answers 404.
 */
@Hidden
@RestController
public class AssetLinksController {

    private final String packageName;
    private final List<String> fingerprints;

    public AssetLinksController(@Value("${APP_ANDROID_PACKAGE:}") String packageName,
            @Value("${APP_ANDROID_CERT_SHA256:}") String fingerprints) {
        this.packageName = packageName.isBlank() ? null : packageName.trim();
        // Read with or without its colons, and written as keytool and the
        // Play Console write one (upper case, colon between each byte); an
        // SHA-1 or a typo is left out rather than published as a
        // certificate no app has.
        this.fingerprints = Arrays.stream(fingerprints.split(","))
                .map(f -> f.trim().toUpperCase(Locale.ROOT).replace(":", ""))
                .filter(f -> f.matches("[0-9A-F]{64}"))
                .map(f -> String.join(":", f.split("(?<=\\G..)")))
                .distinct()
                .toList();
    }

    @GetMapping("/.well-known/assetlinks.json")
    public ResponseEntity<List<Map<String, Object>>> links() {
        if (packageName == null || fingerprints.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(List.of(Map.of(
                "relation", List.of("delegate_permission/common.handle_all_urls"),
                "target", Map.of(
                        "namespace", "android_app",
                        "package_name", packageName,
                        "sha256_cert_fingerprints", fingerprints))));
    }
}
