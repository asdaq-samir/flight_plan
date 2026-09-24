package com.northflyers.vfr.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.controller.PilotController;
import com.northflyers.vfr.security.SecurityConfig;
import com.northflyers.vfr.service.PilotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.resource.CachingResourceResolver;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

/**
 * The front end's own paths: a client-side route is the index, a built
 * asset is served to be kept, a missing one is a 404, and nothing about a
 * path is remembered once it has been answered. Served from a small
 * bundle in the test resources.
 */
@WebMvcTest(value = PilotController.class, properties = "app.static-location=classpath:/spa-test/")
@Import({SecurityConfig.class, WebMvcConfig.class})
class SpaFallbackTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    @Qualifier("resourceHandlerMapping")
    private HandlerMapping resourceHandlerMapping;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void aClientSideRouteIsTheIndex() throws Exception {
        mockMvc.perform(get("/app/label"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("spa index")));
    }

    @Test
    void aBuiltAssetIsServedToBeKeptForAsLongAsTheBrowserLikes() throws Exception {
        mockMvc.perform(get("/app/assets/app-abc123.js"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("immutable")));
    }

    @Test
    void aMissingAssetIsA404NotTheIndex() throws Exception {
        mockMvc.perform(get("/app/assets/app-missing.js"))
                .andExpect(status().isNotFound());
    }

    @Test
    void theBareRootGoesToThePlanner() throws Exception {
        mockMvc.perform(get("/app"))
                .andExpect(redirectedUrl("/app/plan"));
    }

    @Test
    void noPathIsKeptOnceAnswered() {
        // A caching chain kept every path any client sent, unbounded.
        ResourceHttpRequestHandler spa = (ResourceHttpRequestHandler)
                ((SimpleUrlHandlerMapping) resourceHandlerMapping).getUrlMap().get("/app/**");
        assertThat(spa.getResourceResolvers()).noneMatch(CachingResourceResolver.class::isInstance);
    }
}
