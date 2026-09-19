package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.MagicLink;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/** Persistence for {@link MagicLink}. The one lookup a verify click
 *  needs: the hash of whatever token came back in the URL. */
public interface MagicLinkRepository extends JpaRepository<MagicLink, Long> {

    Optional<MagicLink> findByTokenHash(String tokenHash);

    /** Atomically marks the row consumed iff it's still usable -- one
     *  UPDATE ... WHERE, not a read-then-write. Two requests racing the
     *  same token (a double-click, or a token someone else replayed)
     *  can never both see it unconsumed and both sign in: exactly one
     *  UPDATE matches the row, the other matches zero. Returns the
     *  number of rows updated (1 = this call won the race and the
     *  caller should proceed; 0 = already used, expired, or the token
     *  doesn't exist -- these three cases are deliberately
     *  indistinguishable to the caller, same reasoning as {@code
     *  request}'s own always-202 response). */
    @Modifying
    @Transactional
    @Query("UPDATE MagicLink m SET m.consumedAt = :now WHERE m.tokenHash = :tokenHash AND m.consumedAt IS NULL AND m.expiresAt > :now")
    int consumeIfUsable(@Param("tokenHash") String tokenHash, @Param("now") Instant now);
}
