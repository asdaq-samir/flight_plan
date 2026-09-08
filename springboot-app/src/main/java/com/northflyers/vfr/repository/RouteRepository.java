package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Route;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RouteRepository extends JpaRepository<Route, Long> {
}
