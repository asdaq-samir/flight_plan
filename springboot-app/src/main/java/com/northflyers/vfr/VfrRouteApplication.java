package com.northflyers.vfr;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point for webapp -- the public-facing route-planning API. See
 * {@link com.northflyers.vfr.controller.RouteController} for the actual
 * HTTP surface; this class only bootstraps Spring Boot and declares the
 * OpenAPI document's title/description (served at /v3/api-docs).
 */
@SpringBootApplication
@OpenAPIDefinition(info = @Info(
        title = "VFR Route Planning API",
        version = "0.1.0",
        description = "Scores candidate checkpoints and dead-reckoning nav-log data for a VFR route. "
                + "See /swagger-ui/index.html for the interactive docs."))
public class VfrRouteApplication {
    public static void main(String[] args) {
        SpringApplication.run(VfrRouteApplication.class, args);
    }
}
