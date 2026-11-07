package com.northflyers.wingtip.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;

/**
 * What application.yml has the server gzip. The engine's WebAssembly is
 * among it: the first render waits for the module, and sent as it is it
 * was 735 KB where gzip makes it 276 KB, which took Lighthouse's phone
 * LCP on the planner page from 9.0 s to 13.7 s (issue #214). The NDJSON
 * streams stay out, so each line the planner flushes goes at once.
 */
class CompressionSettingsTest {

    private static java.util.List<String> gzipped() {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        Properties properties = yaml.getObject();
        assertThat(properties).isNotNull();
        assertThat(properties.getProperty("server.compression.enabled")).isEqualTo("true");
        return Arrays.asList(properties.getProperty("server.compression.mime-types").split(","));
    }

    @Test
    void theEnginesWebAssemblyIsGzipped() {
        assertThat(gzipped()).contains("application/wasm", "text/javascript", "text/css");
    }

    @Test
    void theStreamsAreNot() {
        assertThat(gzipped()).doesNotContain("application/x-ndjson");
    }
}
