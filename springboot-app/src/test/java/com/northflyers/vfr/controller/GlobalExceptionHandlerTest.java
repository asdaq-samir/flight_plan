package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.dto.ErrorResponse;
import java.io.IOException;
import org.apache.coyote.CloseNowException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

/**
 * The catch-all handler's quiet cases, beside its loud one: a browser
 * that left mid-stream (in HTTP/1.1's words and in HTTP/2's), and a
 * response already on its way, get no body; anything else is a 500
 * with a generic message.
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
    void aStreamThePhoneResetGetsNothing() {
        // Tomcat's own words over HTTP/2 (which the phone's connector
        // spoke, once), unknown to Spring's helper: one while the request
        // was being read, one while the response was being written.
        var reading = new IOException("Client reset the stream before the request was fully read");
        assertThat(handler.handleUnexpected(reading, new MockHttpServletResponse())).isNull();
        var writing = new IOException("Client reset the stream before the response was complete");
        assertThat(handler.handleUnexpected(writing, new MockHttpServletResponse())).isNull();
    }

    @Test
    void aWriteToAStreamAlreadyResetGetsNothing() {
        var notWritable = new CloseNowException("Connection [1], Stream [7], This stream is not writable");
        assertThat(handler.handleUnexpected(notWritable, new MockHttpServletResponse())).isNull();
        // Wrapped, as Spring MVC hands on what a StreamingResponseBody threw.
        var wrapped = new IllegalStateException("the stream failed", notWritable);
        assertThat(handler.handleUnexpected(wrapped, new MockHttpServletResponse())).isNull();
    }

    @Test
    void anyOtherIOExceptionIsStillAnError() {
        ResponseEntity<ErrorResponse> answer = handler.handleUnexpected(new IOException("No space left on device"), new MockHttpServletResponse());
        assertThat(answer.getStatusCode().value()).isEqualTo(500);
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
