package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Route;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Persistence for {@link Route}. Spring Data JPA generates the
 * implementation at startup from {@link JpaRepository}'s signature alone
 * -- {@code findById}/{@code save}/{@code deleteById} etc. are inherited,
 * not written here; add a method signature only when a query beyond that
 * default CRUD set is actually needed.
 */
public interface RouteRepository extends JpaRepository<Route, Long> {
}
