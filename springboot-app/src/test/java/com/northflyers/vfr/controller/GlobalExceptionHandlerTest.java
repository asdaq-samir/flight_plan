package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.dto.ErrorResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

/**
 * The catch-all handler's two quiet cases, beside its loud one: a
 * browser that left mid-stream, and a response already on its way,
 * get no body; anything else is a 500 with a generic message.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void aBrowserThatLeftMidStreamGetsNothing() {
        // What Spring MVC raises when the nav log stream's reader is gone.
        var gone = new AsyncRequestNotUsableException("ServletOutputStream failed to write: java.io.IOException: Broken pipe");
        assertThat(handler.handleUnexpected(gone, new MockHttpServletResponse())).isNull();
    }

    @Test
    void aFailureAfterTheResponseWasSentGetsNoBody() throws Exception {
        MockHttpServletResponse streaming = new MockHttpServletResponse();
        streaming.setContentType("application/x-ndjson");
        streaming.flushBuffer();
        assertThat(handler.handleUnexpected(new IllegalStateException("upstream went away"), streaming)).isNull();
    }

    @Test
    void anythingElseIsA500WithAGenericMessage() {
        ResponseEntity<ErrorResponse> answer = handler.handleUnexpected(new IllegalStateException("boom"), new MockHttpServletResponse());
        assertThat(answer.getStatusCode().value()).isEqualTo(500);
        assertThat(answer.getBody().error()).isEqualTo("An unexpected error occurred");
    }
}
