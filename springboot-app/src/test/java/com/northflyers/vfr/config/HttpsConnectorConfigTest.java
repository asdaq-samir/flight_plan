package com.northflyers.vfr.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.catalina.connector.Connector;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;

/**
 * HTTPS is on only for a keystore that is a readable file. A blank
 * setting -- the default, and AWS's -- resolved to the working
 * directory, passed both old gates, and the webapp failed to start.
 */
class HttpsConnectorConfigTest {

    @TempDir
    Path dir;

    private java.util.List<Connector> connectorsFor(String keystore) {
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory();
        new HttpsConnectorConfig().httpsConnector(keystore, "changeit", 8443).customize(factory);
        return factory.getAdditionalTomcatConnectors();
    }

    @Test
    void aBlankKeystoreIsThePlainPortAlone() {
        assertThat(connectorsFor("")).isEmpty();
    }

    @Test
    void aDirectoryOrAMissingFileIsThePlainPortAlone() {
        assertThat(connectorsFor(dir.toString())).isEmpty();
        assertThat(connectorsFor(dir.resolve("webapp.p12").toString())).isEmpty();
    }

    @Test
    void aReadableFileIsAnHttpsConnector() throws IOException {
        Path keystore = Files.writeString(dir.resolve("webapp.p12"), "not checked until Tomcat starts");
        assertThat(connectorsFor(keystore.toString())).singleElement()
                .satisfies(connector -> assertThat(connector.getScheme()).isEqualTo("https"));
    }
}
