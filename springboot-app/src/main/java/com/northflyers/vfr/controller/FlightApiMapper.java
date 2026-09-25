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

@Mapper(componentModel = "spring")
public interface FlightApiMapper {
    AircraftDto toDto(Aircraft aircraft);

    @Mapping(target = "aircraftTailNumber", source = "aircraft.tailNumber")
    FlightSummaryDto toSummaryDto(Flight flight);

    @Mapping(target = "aircraftTailNumber", source = "aircraft.tailNumber")
    FlightDto toDto(Flight flight);

    FlightCheckpointDto toDto(FlightCheckpoint checkpoint);
}
