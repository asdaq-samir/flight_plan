package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Hidden;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The file iOS reads to open links to this site in the iOS app (its
 * Associated Domains, web/ios): the sign-in link a pilot taps in Mail
 * lands in the app's own session, and a shared route opens there. Apple
 * fetches it from /.well-known/ at the app's install and update, over
 * HTTPS with no redirect.
 *
 * <p>Named by APPLE_TEAM_ID (the same team Sign in with Apple uses) and
 * APP_IOS_BUNDLE_ID; with either missing there is no app to name, and
 * this answers 404.
 */
@Hidden
@RestController
public class AppSiteAssociationController {

    private final String appId;

    public AppSiteAssociationController(@Value("${APPLE_TEAM_ID:}") String teamId,
            @Value("${APP_IOS_BUNDLE_ID:}") String bundleId) {
        this.appId = teamId.isBlank() || bundleId.isBlank() ? null : teamId.trim() + "." + bundleId.trim();
    }

    @GetMapping("/.well-known/apple-app-site-association")
    public ResponseEntity<Map<String, Object>> association() {
        if (appId == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(Map.of("applinks", Map.of(
                "details", List.of(Map.of(
                        "appIDs", List.of(appId),
                        "components", List.of(
                                Map.of("/", "/api/auth/magic-link/verify*", "comment", "the sign-in link"),
                                Map.of("/", "/app/*", "comment", "a page of the app, a shared route among them")))))));
    }
}
