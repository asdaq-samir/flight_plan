package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.MagicLink;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link MagicLink}. The one lookup a verify click
 *  needs: the hash of whatever token came back in the URL. */
public interface MagicLinkRepository extends JpaRepository<MagicLink, Long> {

    Optional<MagicLink> findByTokenHash(String tokenHash);
}
