package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.ModelServiceResponse;
import com.northflyers.vfr.repository.RouteRepository;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class RouteService {

    private final ModelServiceClient modelServiceClient;
    private final RouteRepository routeRepository;

    public RouteService(ModelServiceClient modelServiceClient, RouteRepository routeRepository) {
        this.modelServiceClient = modelServiceClient;
        this.routeRepository = routeRepository;
    }

    /** Calls model-service, persists the result. Always a fresh call --
     * getRoute(id) below is the cached/no-model-service-call path. */
    public Route createRoute(String departureIdent, String destinationIdent) {
        ModelServiceResponse response = modelServiceClient.invoke(departureIdent, destinationIdent);
        Route route = new Route(departureIdent, destinationIdent, response.checkpoints());
        return routeRepository.save(route);
    }

    public Optional<Route> getRoute(Long id) {
        return routeRepository.findById(id);
    }
}
