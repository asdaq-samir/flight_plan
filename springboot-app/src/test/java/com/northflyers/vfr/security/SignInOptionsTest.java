package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;

/** The providers the sign-in dialog offers are the ones registered, and
 *  only those: a button for one that is not opened a blank 401. */
class SignInOptionsTest {

    @Test
    void theProvidersAreTheRegisteredOnes() {
        var google = CommonOAuth2Provider.GOOGLE.getBuilder("google").clientId("id").clientSecret("secret").build();
        var config = new SecurityConfig(Optional.of(new InMemoryClientRegistrationRepository(google)), "", "", true, false, "");
        assertThat(config.signInOptions().providers()).containsExactly("google");
        assertThat(config.signInOptions().access()).isEqualTo(SignInOptions.Access.SIGN_IN);
    }

    @Test
    void noneWhereOnlyTheEmailedLinkSignsIn() {
        var config = new SecurityConfig(Optional.empty(), "mailpit", "", true, false, "");
        assertThat(config.signInOptions().providers()).isEmpty();
        assertThat(config.signInOptions().access()).isEqualTo(SignInOptions.Access.SIGN_IN);
    }
}
