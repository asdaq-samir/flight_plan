package com.northflyers.vfr.service;

import com.northflyers.vfr.dto.ModelServiceRequest;
import com.northflyers.vfr.dto.ModelServiceResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
public class ModelServiceClient {

    private final WebClient webClient;

    public ModelServiceClient(@Value("${model-service.base-url}") String baseUrl) {
        this.webClient = WebClient.builder().baseUrl(baseUrl).build();
    }

    public ModelServiceResponse invoke(String departureIdent, String destinationIdent) {
        return webClient.post()
                .uri("/invocations")
                .bodyValue(new ModelServiceRequest(departureIdent, destinationIdent))
                .retrieve()
                .bodyToMono(ModelServiceResponse.class)
                .block();
    }
}
