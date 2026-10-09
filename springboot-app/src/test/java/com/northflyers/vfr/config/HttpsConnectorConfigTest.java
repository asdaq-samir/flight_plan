package com.northflyers.vfr.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.catalina.connector.Connector;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.Compression;
import org.springframework.util.unit.DataSize;

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
        Compression compression = new Compression();
        compression.setEnabled(true);
        compression.setMimeTypes(new String[] {"text/html", "application/json"});
        compression.setMinResponseSize(DataSize.ofBytes(1024));
        new HttpsConnectorConfig().httpsConnector(keystore, "changeit", 8443, compression).customize(factory);
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

    @Test
    void theHttpsConnectorCompressesAsThePlainPortDoes() throws IOException {
        // server.compression is set on the connector Spring Boot makes; this
        // one is added, so it is given the same: JSON over 1 KB gzipped.
        Path keystore = Files.writeString(dir.resolve("webapp.p12"), "not checked until Tomcat starts");
        Connector connector = connectorsFor(keystore.toString()).getFirst();
        assertThat(connector.getProperty("compression")).isEqualTo("on");
        assertThat(String.valueOf(connector.getProperty("compressibleMimeType"))).contains("application/json");
        assertThat(connector.getProperty("compressionMinSize")).isEqualTo(1024);
    }
}
