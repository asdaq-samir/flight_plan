package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.dto.AircraftDto;
import com.northflyers.vfr.dto.FlightCheckpointDto;
import com.northflyers.vfr.dto.FlightDto;
import com.northflyers.vfr.dto.FlightSummaryDto;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * Compile-time generated API/domain mapping. Keeping this outside the
 * controllers removes repetitive field-by-field DTO construction while
 * retaining explicit, type-safe mappings.
 */
@Mapper(componentModel = "spring")
public interface FlightApiMapper {

    AircraftDto toDto(Aircraft aircraft);

    FlightSummaryDto toSummaryDto(Flight flight);

    FlightDto toDto(Flight flight);

    FlightCheckpointDto toDto(FlightCheckpoint checkpoint);
}
