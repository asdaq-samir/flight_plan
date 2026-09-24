package com.northflyers.vfr.controller;

import com.northflyers.vfr.security.SignInOptions;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What signing in can do here, asked before anyone has.
 *
 * <p>{@code /api/me} answers "who are you", and 401s when nobody is.
 * That is not enough for the front end to decide whether to offer the
 * developer's workspace: a deployment with no Google or Apple
 * credentials and no mail host has no way to hold a role at all, and
 * hiding the workspace there would hide it from the only person who
 * could use it. So this says how the deployment is reached, and the
 * front end shows the switch where it is open to everyone.
 *
 * <p>Public by necessity -- it is the question asked before a session
 * exists -- and it gives nothing away: whether a login button would
 * work is visible from the login page itself.
 */
@RestController
@RequestMapping("/api/auth/capabilities")
@Tag(name = "Auth", description = "What signing in can do in this deployment")
public class SignInCapabilitiesController {

    /** @param access how this deployment is reached (SignInOptions).
     *  @param oauthConfigured whether Google or Apple is really registered. */
    public record Capabilities(
            @Schema(description = "SIGN_IN: a session can be had, and the developer's workspace needs the role. "
                    + "OPEN: nobody can sign in and everything is open (the local stack). "
                    + "CLOSED: nobody can sign in, and writes and the developer's workspace are refused.",
                    example = "SIGN_IN") SignInOptions.Access access,
            @Schema(description = "Google or Apple has real credentials registered.",
                    example = "true") boolean oauthConfigured) {}

    private final SignInOptions signIn;

    public SignInCapabilitiesController(SignInOptions signIn) {
        this.signIn = signIn;
    }

    @Operation(summary = "Whether anyone can sign in here")
    @GetMapping
    public Capabilities capabilities() {
        return new Capabilities(signIn.access(), signIn.oauthConfigured());
    }
}
