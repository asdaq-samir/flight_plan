package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.CheckpointDto;
import com.northflyers.vfr.service.ModelServiceException;
import com.northflyers.vfr.service.RouteService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Covers the HTTP contract: what a caller actually gets back for a good
 * request, a malformed one, and an upstream failure. {@link RouteService}
 * is mocked -- this is about status codes and response shape, not the
 * service logic underneath (see RouteServiceTest for that).
 */
// The real rules rather than Spring Security's defaults, so this slice
// exercises the same permitAll for /api/routes that production has --
// and so a change that accidentally made scored routes private would
// fail here.
@WebMvcTest(RouteController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class RouteControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private RouteService routeService;

    private static Route sampleRoute() {
        return new Route("C81", "KDLH", List.of(
                new CheckpointDto("411077224", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41)));
    }

    @Test
    void createRoute_returns200_forAValidRequest() throws Exception {
        given(routeService.createRoute(anyString(), anyString())).willReturn(sampleRoute());

        mockMvc.perform(post("/api/routes").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.departureIdent").value("C81"))
                .andExpect(jsonPath("$.checkpoints[0].osmId").value("411077224"));
    }

    @Test
    void createRoute_returns400_whenAnIdentIsBlank() throws Exception {
        mockMvc.perform(post("/api/routes").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"\",\"destinationIdent\":\"KDLH\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Invalid request"))
                .andExpect(jsonPath("$.details").isNotEmpty());
    }

    @Test
    void createRoute_returns400_whenAnIdentIsTheWrongShape() throws Exception {
        mockMvc.perform(post("/api/routes").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"toolongident\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Invalid request"));
    }

    /**
     * The reason GlobalExceptionHandler exists: model-service being down is
     * an upstream failure, so it has to read as 502 rather than a generic
     * 500, and the response must not leak the underlying transport error.
     */
    @Test
    void createRoute_returns502_whenModelServiceIsUnreachable() throws Exception {
        willThrow(new ModelServiceException("model-service call failed", new RuntimeException("connection refused")))
                .given(routeService).createRoute(anyString(), anyString());

        mockMvc.perform(post("/api/routes").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("The model-scoring service is currently unavailable"));
    }

    @Test
    void getRoute_returns200_whenTheRouteExists() throws Exception {
        given(routeService.getRoute(any())).willReturn(Optional.of(sampleRoute()));

        mockMvc.perform(get("/api/routes/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.destinationIdent").value("KDLH"));
    }

    @Test
    void listRoutes_returns405_becauseOnlyPostIsMapped() throws Exception {
        mockMvc.perform(get("/api/routes")).andExpect(status().isMethodNotAllowed());
    }

    @Test
    void getRoute_returns404_whenTheRouteIsAbsent() throws Exception {
        given(routeService.getRoute(any())).willReturn(Optional.empty());

        mockMvc.perform(get("/api/routes/999")).andExpect(status().isNotFound());
    }
}
