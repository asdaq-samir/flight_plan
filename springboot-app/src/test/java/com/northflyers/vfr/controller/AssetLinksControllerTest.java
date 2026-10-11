package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** The app Android opens this site's links in: named, with the
 *  certificates that sign it, when both are set, and none otherwise. */
class AssetLinksControllerTest {

    private static final String PLAY =
            "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

    @Test
    @SuppressWarnings("unchecked")
    void theAppIsNamedWithTheCertificatesThatSignIt() {
        // The upload key's as keytool -list prints it, lower case and
        // without colons as some tools do.
        String upload = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
        ResponseEntity<List<Map<String, Object>>> answer =
                new AssetLinksController("app.wingtipmaps.android", PLAY + ", " + upload + ",").links();
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> link = answer.getBody().get(0);
        assertThat(link.get("relation")).isEqualTo(List.of("delegate_permission/common.handle_all_urls"));
        Map<String, Object> target = (Map<String, Object>) link.get("target");
        assertThat(target.get("namespace")).isEqualTo("android_app");
        assertThat(target.get("package_name")).isEqualTo("app.wingtipmaps.android");
        assertThat((List<String>) target.get("sha256_cert_fingerprints")).containsExactly(PLAY,
                "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90");
    }

    @Test
    void aFingerprintThatIsNotOneIsLeftOut() {
        // An SHA-1 (20 bytes), the wrong digest for App Links.
        ResponseEntity<List<Map<String, Object>>> answer = new AssetLinksController("app.wingtipmaps.android",
                "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42").links();
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void withNoAppThereIsNoFile() {
        assertThat(new AssetLinksController("", PLAY).links().getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(new AssetLinksController("app.wingtipmaps.android", " ").links().getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }
}
