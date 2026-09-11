package com.northflyers.vfr.config;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves the front end, with client-side routes falling back to its
 * index.
 *
 * <p>{@code /app/plan} and {@code /app/label} are routes inside the
 * bundle, not files, so the static handler would answer 404 and the
 * browser would never get the chance to route them. This resolves a real
 * file when there is one and hands back the index when there is not.
 *
 * <p>Done here rather than with a controller that forwards to
 * {@code /app/index.html}: any mapping wide enough to catch the SPA
 * routes also catches that forward, and the request forwards to itself
 * until the stack runs out. Resolving the resource directly has no such
 * loop to fall into.
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/app/**")
                .addResourceLocations("classpath:/static/app/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) {
                            return requested;
                        }
                        // A client-side route. Never a missing asset:
                        // those live under /app/assets/ with hashed names
                        // and either exist or are a genuine 404, so they
                        // are let through to be one.
                        if (resourcePath.startsWith("assets/")) {
                            return null;
                        }
                        return location.createRelative("index.html");
                    }
                });
    }
}
