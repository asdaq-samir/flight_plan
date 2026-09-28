package com.northflyers.vfr.security;

import com.northflyers.vfr.domain.Pilot;

/**
 * Where a sign-in lands: a developer in dev mode, where their work is,
 * anyone else on the planner. One answer for both ways in -- the emailed
 * link (MagicLinkController) and Google/Apple (SecurityConfig).
 */
public final class SignInLanding {

    private SignInLanding() {}

    public static String after(Pilot pilot) {
        return pilot.getRole().isDeveloper() ? "/app/dev" : "/app/plan";
    }
}
