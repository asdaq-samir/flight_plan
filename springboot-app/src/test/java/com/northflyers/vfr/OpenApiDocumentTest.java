package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The committed springboot-app/openapi.json is what web/ generates its
 * types for this app's endpoints from ({@code npm run types}), so it has
 * to be the document this code actually serves -- the same guarantee
 * planning-service's tests/test_openapi.py gives for the planner's.
 *
 * <p>After changing a controller or a DTO, regenerate it by running the
 * suite with {@code WRITE_OPENAPI=1} in the environment, and commit the
 * file. Written with sorted keys, so a regeneration diffs as the change
 * it is and nothing else.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class OpenApiDocumentTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    /** Maven runs the tests from springboot-app/. */
    private static final Path DOCUMENT = Path.of("openapi.json");

    @Autowired
    private MockMvc mockMvc;

    @Test
    void theCommittedDocumentIsTheOneThisAppServes() throws Exception {
        String served = sorted(mockMvc.perform(get("/v3/api-docs")).andReturn()
                .getResponse().getContentAsString(StandardCharsets.UTF_8));
        if ("1".equals(System.getenv("WRITE_OPENAPI"))) {
            Files.writeString(DOCUMENT, served);
        }
        assertThat(Files.readString(DOCUMENT))
                .as("a controller or DTO changed: run the suite with WRITE_OPENAPI=1 and commit springboot-app/openapi.json")
                .isEqualTo(served);
    }

    private static String sorted(String json) throws Exception {
        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
        Map<?, ?> document = mapper.readValue(json, Map.class);
        return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(document) + "\n";
    }
}
