package com.northflyers.vfr.config;

import io.swagger.v3.core.converter.AnnotatedType;
import io.swagger.v3.oas.models.servers.Server;
import java.lang.annotation.Annotation;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TreeSet;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springdoc.core.customizers.PropertyCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Makes the OpenAPI document say what Jackson actually sends, because
 * the front end's types are generated from it
 * (springboot-app/openapi.json, then {@code npm run types}).
 *
 * <p>Out of the box springdoc marks no field required and none nullable,
 * which generates a type where every field may be missing and none may
 * be null -- the opposite of this app, where Jackson writes every field
 * of every record, as null where there is nothing. So every property is
 * listed as required, and one declared {@code @Nullable} in its DTO
 * gains {@code null} as a type. A field that can be null and is not
 * annotated generates a type that says it cannot be: the annotation is
 * the contract.
 */
@Configuration
public class OpenApiConfig {

    @Bean
    PropertyCustomizer nullableWhereDeclared() {
        return (property, type) -> {
            if (declaredNullable(type)) {
                if (property.getTypes() != null && !property.getTypes().isEmpty()) {
                    property.addType("null");
                } else {
                    property.setNullable(true);
                }
            }
            return property;
        };
    }

    @Bean
    OpenApiCustomizer everyFieldPresent() {
        return openApi -> {
            // The same document wherever it is served from: the page is
            // always on the webapp's own origin.
            openApi.setServers(List.of(new Server().url("/")));
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            openApi.getComponents().getSchemas().values().forEach(schema -> {
                if (schema.getProperties() != null && !schema.getProperties().isEmpty()) {
                    schema.setRequired(new ArrayList<>(new TreeSet<>(schema.getProperties().keySet())));
                }
            });
        };
    }

    /** Any annotation named {@code Nullable} -- Spring's, Jakarta's or
     *  JSR-305's all mean the same thing here. */
    private static boolean declaredNullable(AnnotatedType type) {
        Annotation[] annotations = type.getCtxAnnotations();
        return annotations != null && Arrays.stream(annotations)
                .anyMatch(a -> a.annotationType().getSimpleName().equals("Nullable"));
    }
}
