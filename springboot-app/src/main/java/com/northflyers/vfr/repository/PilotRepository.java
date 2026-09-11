package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Pilot;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Persistence for {@link Pilot}.
 *
 * <p>The two lookups are what a sign-in needs: match on Google's stable
 * {@code sub} first, and fall back to email only to adopt a record
 * created before that pilot had ever signed in.
 */
public interface PilotRepository extends JpaRepository<Pilot, Long> {

    Optional<Pilot> findByGoogleSubject(String googleSubject);

    Optional<Pilot> findByEmail(String email);
}
