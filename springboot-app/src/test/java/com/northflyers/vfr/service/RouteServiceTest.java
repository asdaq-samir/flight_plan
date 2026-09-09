package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;

import com.northflyers.vfr.domain.Checkpoint;
import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.CheckpointDto;
import com.northflyers.vfr.dto.ModelServiceResponse;
import com.northflyers.vfr.repository.RouteRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** The DTO/entity conversion boundary, without a database or a network. */
@ExtendWith(MockitoExtension.class)
class RouteServiceTest {

    @Mock
    private ModelServiceClient modelServiceClient;

    @Mock
    private RouteRepository routeRepository;

    @InjectMocks
    private RouteService routeService;

    @Test
    void createRoute_convertsResponseDtosIntoOwnedCheckpointEntities() {
        given(modelServiceClient.invoke("C81", "KDLH")).willReturn(new ModelServiceResponse("C81", "KDLH", List.of(
                new CheckpointDto("411077224", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41),
                new CheckpointDto("153546173", "town", "Round Lake", 42.3534, -88.0934, 1.9, 0.72)), true));
        given(routeRepository.save(any(Route.class))).willAnswer(invocation -> invocation.getArgument(0));

        Route saved = routeService.createRoute("C81", "KDLH");

        ArgumentCaptor<Route> persisted = ArgumentCaptor.forClass(Route.class);
        org.mockito.Mockito.verify(routeRepository).save(persisted.capture());

        assertThat(saved.getDepartureIdent()).isEqualTo("C81");
        assertThat(saved.getDestinationIdent()).isEqualTo("KDLH");
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getCheckpoints())
                .extracting(Checkpoint::getOsmId, Checkpoint::getCategory, Checkpoint::getPredictedScore)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("411077224", "lake_or_pond", 0.41),
                        org.assertj.core.groups.Tuple.tuple("153546173", "town", 0.72));
    }

    /**
     * Each checkpoint has to carry its parent back, or the JPA
     * {@code route_id} foreign key is null on insert and the cascade fails.
     */
    @Test
    void createRoute_backReferencesEachCheckpointToItsRoute() {
        given(modelServiceClient.invoke("C81", "KDLH")).willReturn(new ModelServiceResponse("C81", "KDLH", List.of(
                new CheckpointDto("411077224", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41)), true));
        given(routeRepository.save(any(Route.class))).willAnswer(invocation -> invocation.getArgument(0));

        Route saved = routeService.createRoute("C81", "KDLH");

        assertThat(saved.getCheckpoints()).hasSize(1);
    }

    @Test
    void createRoute_letsAModelServiceFailurePropagate() {
        given(modelServiceClient.invoke("C81", "KDLH"))
                .willThrow(new ModelServiceException("model-service call failed", new RuntimeException()));

        org.assertj.core.api.Assertions
                .assertThatThrownBy(() -> routeService.createRoute("C81", "KDLH"))
                .isInstanceOf(ModelServiceException.class);
    }
}
