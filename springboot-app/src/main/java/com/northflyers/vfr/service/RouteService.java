package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.ModelServiceResponse;
import com.northflyers.vfr.repository.RouteRepository;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Route creation and lookup -- the one place {@link ModelServiceClient}
 * (the scoring call) and {@link RouteRepository} (persistence) meet.
 */
@Service
public class RouteService {

    private final ModelServiceClient modelServiceClient;
    private final RouteRepository routeRepository;

    public RouteService(ModelServiceClient modelServiceClient, RouteRepository routeRepository) {
        this.modelServiceClient = modelServiceClient;
        this.routeRepository = routeRepository;
    }

    /**
     * Calls model-service, persists the result. Always a fresh scoring
     * call -- {@link #getRoute} below is the cached/no-model-service-call
     * path for anything already saved.
     *
     * @param departureIdent   departure airport ident
     * @param destinationIdent destination airport ident
     * @return the saved {@link Route}, with its generated id and scored checkpoints
     * @throws ModelServiceException if model-service (or SageMaker) can't be reached
     */
    public Route createRoute(String departureIdent, String destinationIdent) {
        ModelServiceResponse response = modelServiceClient.invoke(departureIdent, destinationIdent);
        Route route = new Route(departureIdent, destinationIdent, response.checkpoints());
        return routeRepository.save(route);
    }

    /**
     * Looks up a previously-saved route by id.
     *
     * @param id the route's generated id
     * @return the route, or empty if no route with that id exists
     */
    public Optional<Route> getRoute(Long id) {
        return routeRepository.findById(id);
    }
}
