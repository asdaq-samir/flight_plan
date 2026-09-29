package com.northflyers.vfr.config;

import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.catalina.connector.Connector;
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
 * <p>HTTP/1.1 only, no HTTP/2. HTTP/2 was on, on the reasoning that a
 * pan's dozen tiles would arrive over one connection instead of
 * queueing six at a time; measured on the LAN, at phone speed, the
 * last tile of a pan arrived 1266 ms after the drag over HTTP/2 and
 * 1267 ms over HTTP/1.1 (median of 15 pans each). What HTTP/2 did
 * cost: a page reloaded with a detection stream in flight resets its
 * streams, and Tomcat (10.1.55 and 10.1.60 alike) recycling a reset
 * stream while a request still ran on it died with a
 * NullPointerException in the thread and failed the request the phone
 * was making -- 2 to 4 of every 240 cancelled requests -- which a
 * pilot met as "Load failed" in a toast. Over HTTP/1.1 the same 240
 * cancelled requests killed no thread.
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
            log.info("HTTPS on port {}, certificate from {}", port, keystore);
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
