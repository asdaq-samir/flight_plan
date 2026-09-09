package com.northflyers.vfr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.northflyers.vfr.dto.ModelServiceRequest;
import com.northflyers.vfr.dto.ModelServiceResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientException;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.sagemakerruntime.SageMakerRuntimeClient;
import software.amazon.awssdk.services.sagemakerruntime.model.InvokeEndpointRequest;
import software.amazon.awssdk.services.sagemakerruntime.model.InvokeEndpointResponse;

/**
 * Calls model-service for scored checkpoints. Locally that's a plain HTTP
 * POST to the model-service container's own /invocations route. On AWS,
 * model-service's image IS a SageMaker Endpoint's serving container --
 * there's no standalone HTTP service to call, so the identical
 * request/response contract is sent through SageMaker Runtime's
 * InvokeEndpoint API instead, which proxies straight to that same
 * container's /invocations route.
 *
 * <p>Which path runs is decided by whether SAGEMAKER_ENDPOINT_NAME is set
 * -- true only on AWS, where WebappTaskDefinition
 * (infra/cloudformation/template.yaml) passes it -- rather than a separate
 * feature flag, since that presence is already the one true signal for
 * "am I running on AWS."
 *
 * <p>Either transport's failure surfaces as {@link ModelServiceException},
 * so RouteService/GlobalExceptionHandler don't need to know which one is
 * actually in play -- see that class's Javadoc.
 */
@Component
public class ModelServiceClient {

    private final WebClient webClient;
    private final SageMakerRuntimeClient sageMakerClient;
    private final String sageMakerEndpointName;
    private final ObjectMapper objectMapper;

    /**
     * Builds both possible transports eagerly except the SageMaker one,
     * which is skipped entirely when {@code sageMakerEndpointName} is
     * blank -- avoids constructing an AWS SDK client (and its implicit
     * credential-chain resolution) on a machine that will never use it.
     */
    public ModelServiceClient(
            @Value("${model-service.base-url}") String baseUrl,
            @Value("${model-service.sagemaker-endpoint-name:}") String sageMakerEndpointName,
            ObjectMapper objectMapper) {
        this.webClient = WebClient.builder().baseUrl(baseUrl).build();
        this.sageMakerEndpointName = sageMakerEndpointName;
        this.sageMakerClient = sageMakerEndpointName.isBlank() ? null : SageMakerRuntimeClient.create();
        this.objectMapper = objectMapper;
    }

    public ModelServiceResponse invoke(String departureIdent, String destinationIdent) {
        ModelServiceRequest request = new ModelServiceRequest(departureIdent, destinationIdent);
        return sageMakerEndpointName.isBlank() ? invokeHttp(request) : invokeSageMaker(request);
    }

    private ModelServiceResponse invokeHttp(ModelServiceRequest request) {
        try {
            return webClient.post()
                    .uri("/invocations")
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(ModelServiceResponse.class)
                    .block();
        } catch (WebClientException e) {
            throw new ModelServiceException("model-service call failed", e);
        }
    }

    private ModelServiceResponse invokeSageMaker(ModelServiceRequest request) {
        try {
            byte[] payload = objectMapper.writeValueAsBytes(request);
            InvokeEndpointResponse response = sageMakerClient.invokeEndpoint(InvokeEndpointRequest.builder()
                    .endpointName(sageMakerEndpointName)
                    .contentType("application/json")
                    .body(SdkBytes.fromByteArray(payload))
                    .build());
            return objectMapper.readValue(response.body().asByteArray(), ModelServiceResponse.class);
        } catch (IOException e) {
            throw new ModelServiceException("Failed to serialize/deserialize SageMaker request", e);
        } catch (SdkException e) {
            throw new ModelServiceException("SageMaker endpoint " + sageMakerEndpointName + " call failed", e);
        }
    }
}
