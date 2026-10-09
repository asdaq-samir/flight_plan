package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** The app iOS opens this site's links in: named when both its team and
 *  its bundle are set, and none at all otherwise. */
class AppSiteAssociationControllerTest {

    @Test
    @SuppressWarnings("unchecked")
    void theAppIsNamedForTheSignInLinkAndTheAppsPages() {
        ResponseEntity<Map<String, Object>> answer =
                new AppSiteAssociationController("ABCDE12345", "app.wingtipmaps.ios").association();
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> details = ((List<Map<String, Object>>) ((Map<String, Object>) answer.getBody()
                .get("applinks")).get("details")).get(0);
        assertThat(details.get("appIDs")).isEqualTo(List.of("ABCDE12345.app.wingtipmaps.ios"));
        assertThat((List<Map<String, String>>) details.get("components")).extracting(c -> c.get("/"))
                .containsExactly("/api/auth/magic-link/verify*", "/app/*");
    }

    @Test
    void withNoAppThereIsNoFile() {
        assertThat(new AppSiteAssociationController("", "app.wingtipmaps.ios").association().getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(new AppSiteAssociationController("ABCDE12345", " ").association().getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }
}
