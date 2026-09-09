package com.northflyers.vfr.service;

/**
 * Wraps a failure reaching model-service, regardless of which of
 * ModelServiceClient's two transports (WebClient locally, SageMaker
 * Runtime on AWS) actually failed -- callers shouldn't need to know or
 * care which one is in play.
 */
public class ModelServiceException extends RuntimeException {

    public ModelServiceException(String message, Throwable cause) {
        super(message, cause);
    }
}
