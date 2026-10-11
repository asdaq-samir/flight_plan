package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.PaidFeature;
import com.northflyers.vfr.domain.Subscription;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

/**
 * A pilot's subscription as the app shows it: whether the paid features
 * are theirs, until when, and this month's uses of each against its cap.
 * For the page to say so; the server checks it again on every paid call.
 */
@Schema(description = "The signed-in pilot's subscription to the paid features")
public record SubscriptionDto(
        @Schema(description = "FREE (none), TRIAL (the free month), SUBSCRIBED (paid for), or COMPED (given: "
                + "a developer's, an instructor's)", example = "TRIAL") State state,
        @Schema(description = "Whether the paid features are theirs now", example = "true") boolean entitled,
        @Schema(description = "When the free month or the paid time runs out; null for FREE and COMPED")
        @Nullable Instant until,
        @Schema(description = "Whether the free month is still theirs to start: once an account",
                example = "false") boolean trialAvailable,
        @Schema(description = "The free month's length, days", example = "30") int trialDays,
        @Schema(description = "MONTHLY or YEARLY, when paid for") @Nullable Subscription.Plan plan,
        @Schema(description = "Where it was bought, when paid for") @Nullable Subscription.Store store,
        @Schema(description = "This month's uses of each paid feature Claude writes, against its cap")
        List<FeatureUse> uses) {

    public enum State { FREE, TRIAL, SUBSCRIBED, COMPED }

    @Schema(description = "One paid feature's uses this month (UTC)")
    public record FeatureUse(
            @Schema(example = "NARRATIVE") PaidFeature feature,
            @Schema(example = "3") int used,
            @Schema(description = "The month's allowance", example = "60") int cap) {
    }
}
