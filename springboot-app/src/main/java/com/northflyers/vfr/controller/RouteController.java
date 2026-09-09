package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.RouteRequest;
import com.northflyers.vfr.service.RouteService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The HTTP boundary for routes: score a new one, look up a saved one.
 * Deliberately thin -- both methods just delegate to {@link RouteService}
 * and shape the result as a {@link ResponseEntity}; a bad request or a
 * downstream failure is handled centrally by {@link GlobalExceptionHandler},
 * not here.
 */
@RestController
@RequestMapping("/api/routes")
public class RouteController {

    private final RouteService routeService;

    public RouteController(RouteService routeService) {
        this.routeService = routeService;
    }

    /**
     * Scores a new route via model-service (or SageMaker, on AWS) and
     * persists it.
     *
     * @param request departure/destination airport idents; validated by
     *                 {@link RouteRequest}'s own Bean Validation annotations
     * @return 200 with the saved {@link Route}, including its generated id
     */
    @PostMapping
    public ResponseEntity<Route> createRoute(@Valid @RequestBody RouteRequest request) {
        Route route = routeService.createRoute(request.departureIdent(), request.destinationIdent());
        return ResponseEntity.ok(route);
    }

    /**
     * Looks up a previously-saved route -- no model-service/SageMaker call,
     * a straight database read.
     *
     * @param id the route's generated id, from {@link #createRoute}'s response
     * @return 200 with the route if found, otherwise 404
     */
    @GetMapping("/{id}")
    public ResponseEntity<Route> getRoute(@PathVariable Long id) {
        return routeService.getRoute(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
