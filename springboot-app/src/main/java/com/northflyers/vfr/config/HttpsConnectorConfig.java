package com.northflyers.vfr.config;

import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.catalina.connector.Connector;
import org.apache.coyote.http2.Http2Protocol;
import org.apache.tomcat.util.net.SSLHostConfig;
import org.apache.tomcat.util.net.SSLHostConfigCertificate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A second, HTTPS port beside the plain one, for a phone on the same
 * Wi-Fi: the browser grants geolocation (the own-ship position on the
 * chart) and a service worker (the route's charts kept for the air)
 * only to a secure origin, and {@code http://10.0.0.x:8080} is not one.
 * On AWS the load balancer terminates TLS and this never runs.
 *
 * <p>Enabled by {@code app.https.keystore} ({@code APP_HTTPS_KEYSTORE}):
 * a PKCS12 file holding the server certificate and key, as
 * {@code infra/local-https/make-certs.sh} writes one, signed by a
 * local CA the phone is told to trust once. Not Spring Boot's own
 * {@code server.ssl.*}: that turns the one connector HTTPS-only, and
 * the plain port stays for everything on this machine (the e2e suite,
 * the planner's own health probe, a terminal's curl).
 *
 * <p>HTTP/2 is on for this connector. It is what makes a pan across
 * the chart feel light on a phone: the dozen tiles a pan asks for
 * arrive over one connection instead of queueing six at a time.
 *
 * <p>"Configured" is one check: the keystore names a readable regular
 * file. It used to be two gates a blank value passed -- the property is
 * always present (application.yml defaults it to empty), and a blank
 * path resolves to the working directory, which is readable -- so a
 * webapp started without {@code APP_HTTPS_KEYSTORE}, as on AWS, failed
 * to start trying to load a keystore from "".
 */
@Configuration
public class HttpsConnectorConfig {

    private static final Logger log = LoggerFactory.getLogger(HttpsConnectorConfig.class);

    @Bean
    WebServerFactoryCustomizer<TomcatServletWebServerFactory> httpsConnector(
            @Value("${app.https.keystore:}") String keystore,
            @Value("${app.https.keystore-password:changeit}") String password,
            @Value("${app.https.port:8443}") int port) {
        return factory -> {
            // docker-compose.yml names the file whether or not make-certs.sh
            // has been run yet; absent, the plain port is all there is.
            if (!isKeystore(keystore)) {
                log.info("no HTTPS: app.https.keystore '{}' is not a readable file "
                        + "(infra/local-https/make-certs.sh writes one)", keystore);
                return;
            }
            log.info("HTTPS with HTTP/2 on port {}, certificate from {}", port, keystore);
            Connector connector = new Connector("org.apache.coyote.http11.Http11NioProtocol");
            connector.setPort(port);
            connector.setScheme("https");
            connector.setSecure(true);
            connector.setProperty("SSLEnabled", "true");
            SSLHostConfig ssl = new SSLHostConfig();
            SSLHostConfigCertificate certificate = new SSLHostConfigCertificate(ssl, SSLHostConfigCertificate.Type.UNDEFINED);
            certificate.setCertificateKeystoreFile(keystore);
            certificate.setCertificateKeystorePassword(password);
            certificate.setCertificateKeystoreType("PKCS12");
            ssl.addCertificate(certificate);
            connector.addSslHostConfig(ssl);
            connector.addUpgradeProtocol(new Http2Protocol());
            factory.addAdditionalTomcatConnectors(connector);
        };
    }

    static boolean isKeystore(String keystore) {
        if (keystore == null || keystore.isBlank()) {
            return false;
        }
        Path path = Path.of(keystore);
        return Files.isRegularFile(path) && Files.isReadable(path);
    }
}
