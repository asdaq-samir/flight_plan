package com.northflyers.vfr.domain;

/**
 * What the subscription unlocks, each as a pilot reads it in a sentence.
 * Planning and flying -- the chart, the route, checkpoints, the nav log,
 * altitudes, fuel, weather, airspace, the Go / No-Go -- are free and are
 * none of these: nothing that keeps a pilot legal or safe is paid for.
 *
 * <p>{@code capped} is whether each use is a Claude call this app pays
 * for, counted against a monthly allowance (SubscriptionService); the
 * debrief is measured on the device and costs nothing a use.
 */
public enum PaidFeature {
    NARRATIVE("The written briefing comes", "written briefings", true),
    CHECKPOINT_NOTES("Checkpoint descriptions come", "checkpoint descriptions", true),
    ORAL("The mock oral comes", "mock-oral questions and grades", true),
    DEBRIEF("The debrief comes", "debriefs", false);

    private final String comes;
    private final String counted;
    private final boolean capped;

    PaidFeature(String comes, String counted, boolean capped) {
        this.comes = comes;
        this.counted = counted;
        this.capped = capped;
    }

    /** "The written briefing comes", a sentence's start, its verb agreeing. */
    public String comes() {
        return comes;
    }

    /** "the written briefing", as a sentence's object. */
    public String object() {
        String title = comes.substring(0, comes.lastIndexOf(' '));
        return Character.toLowerCase(title.charAt(0)) + title.substring(1);
    }

    /** "written briefings", as a month's count of it is said. */
    public String counted() {
        return counted;
    }

    public boolean capped() {
        return capped;
    }
}
