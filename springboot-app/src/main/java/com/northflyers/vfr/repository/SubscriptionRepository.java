package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Subscription;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persistence for {@link Subscription}, and the month's uses of each
 * paid feature the caps are counted against (V19's paid_feature_uses),
 * which have no entity: they are a count, written in one statement.
 */
public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {

    /** One more use this month, in one statement, so two at once both count. */
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO paid_feature_uses (pilot_id, month, feature, uses) VALUES (:pilot, :month, :feature, 1)
            ON CONFLICT (pilot_id, month, feature) DO UPDATE SET uses = paid_feature_uses.uses + 1
            """, nativeQuery = true)
    void countUse(@Param("pilot") Long pilotId, @Param("month") LocalDate month, @Param("feature") String feature);

    /** This month's uses so far, a [feature, uses] row each. */
    @Query(value = "SELECT feature, uses FROM paid_feature_uses WHERE pilot_id = :pilot AND month = :month",
            nativeQuery = true)
    List<Object[]> usesIn(@Param("pilot") Long pilotId, @Param("month") LocalDate month);
}
