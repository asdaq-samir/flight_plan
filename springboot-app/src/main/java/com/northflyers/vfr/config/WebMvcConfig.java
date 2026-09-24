package com.northflyers.vfr.config;

import java.io.IOException;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.server.MimeMappings;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.server.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
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
 *
 * <p>Where the bundle lives is {@code app.static-location}: the classpath
 * by default (a local {@code mvn package} after {@code vite build} wrote
 * into {@code src/main/resources/static/app}), a directory beside the jar
 * in the Docker image ({@code file:/app/static/app/}, see the
 * Dockerfile) -- so a front-end change rebuilds the bundle without
 * rebuilding the jar.
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final String staticLocation;

    public WebMvcConfig(@Value("${app.static-location:classpath:/static/app/}") String staticLocation) {
        this.staticLocation = staticLocation;
    }

    /**
     * The bare app root ({@code /app} or {@code /app/}) is a real 500,
     * not a routing edge case: it dispatches to the resource handler
     * below with nothing left of the path after the {@code /app/}
     * prefix is stripped, which Spring normalizes to {@code "."} --
     * and rejects as an invalid resource path before the custom
     * resolver below ever runs, regardless of what it would have
     * returned. A redirect sidesteps it entirely: the browser reissues
     * the request for a concrete file, which resolves normally.
     */
    /**
     * The web app manifest ({@code /app/manifest.webmanifest}, from
     * vite-plugin-pwa) served as what it is: Tomcat's own mime table
     * has no entry for the extension and sends it as an octet stream,
     * which a browser installing the app to its home screen may
     * refuse.
     */
    @Bean
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> manifestMimeType() {
        return factory -> {
            MimeMappings mappings = new MimeMappings(MimeMappings.DEFAULT);
            mappings.add("webmanifest", "application/manifest+json");
            factory.setMimeMappings(mappings);
        };
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        // /app/plan, not /app/index.html: that file resolves fine (it's
        // a real resource, sidestepping the "." bug above) but the SPA
        // itself would then see a path ending in "index.html," not one
        // of its own route names, and fall through to whichever view
        // main.tsx's own catch-all happens to be. A route name it
        // already checks for keeps the redirect target and the SPA's
        // own routing in agreement. Plan is the app's own homepage, not
        // a separate landing page one hop removed from it.
        registry.addRedirectViewController("/app", "/app/plan");
        registry.addRedirectViewController("/app/", "/app/plan");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // The bundle's own files carry a content hash in their names
        // (index-D7d2ktXG.js), so a browser may keep them for as long
        // as it likes: a new build is new names, and index.html -- the
        // one file that names them -- is served through the handler
        // below and keeps Spring Security's no-store. Without this every
        // page load re-downloaded a megabyte of JavaScript.
        registry.addResourceHandler("/app/assets/**")
                .addResourceLocations(staticLocation + "assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
        // resourceChain(false): a chain that caches wraps the resolver in
        // a map from request path to resource with no bound -- and as
        // every path under /app resolves (to the index, failing a file),
        // each one any client invents stayed in memory for the life of
        // the process. Resolving afresh is one file lookup per request.
        registry.addResourceHandler("/app/**")
                .addResourceLocations(staticLocation)
                .resourceChain(false)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        // checkResource is the resolver's own guard that
                        // the file is under the location -- it matters
                        // now that the location can be a directory on
                        // disk, not only a path inside the jar.
                        if (requested.isReadable() && checkResource(requested, location)) {
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
