package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Pilot;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;

/**
 * Persistence for {@link Pilot}.
 *
 * <p>The subject lookups are what a sign-in needs: match on the
 * provider's own stable {@code sub} first, and fall back to email only
 * to adopt a record created before that pilot had ever signed in
 * through that particular provider.
 */
public interface PilotRepository extends JpaRepository<Pilot, Long> {

    Optional<Pilot> findByGoogleSubject(String googleSubject);

    Optional<Pilot> findByAppleSubject(String appleSubject);

    Optional<Pilot> findByEmail(String email);

    /** The pilot's row, deleted by the database itself, whose ON DELETE
     *  CASCADE takes their aircraft, their flights with each one's nav log
     *  and track, their logbook and their endorsements with it (V3, V12,
     *  V13, V15) -- rather than by Hibernate, which knows none of those as
     *  the pilot's. */
    @Modifying
    @Query("DELETE FROM Pilot p WHERE p.id = :id")
    int deleteNow(@Param("id") Long id);
}
