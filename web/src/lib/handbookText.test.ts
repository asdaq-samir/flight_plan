import { describe, expect, it } from "vitest";
import { figuresOfPage } from "./handbookText";

const values = (text: string) => Object.fromEntries(Object.entries(figuresOfPage(text)).map(([k, f]) => [k, f.value]));

describe("a handbook's specifications page read", () => {
  it("gives a Piper's figures, in knots where it prints mph", () => {
    // The Cherokee 140 "D" handbook's page 1, the owner's photo of it as
    // Tesseract read it (lib/readPage): its misreads ("sca", "{flaps",
    // "(142%)") kept.
    const page = `CHEROKEE 140 “D" SECTION |
SECTION |
SPECIFICATIONS
PERFORMANCE

The gross weight of 2150 pounds in the following performance
charts applies to Serial Nos. 28-25001 and up.

GROSS WEIGHT 2150

Take-off Run (ft) (flaps up) 800

Take-off Distance Over 50-ft

Obstacle (ft) {flaps up) 1700

Best Rate of Climb Speed (mph) 85

Rate of Climb (ft per min) 660

Service Ceiling (ft) 14,300

Absolute Ceiling 16,800

Top Speed (mph) 139 (142%)

Cruising Speed (75% power, sca

level) (mph) 121 (124%)

Optimum Cruising Speed (75%

power, 7000 ft, mph) 132 (135)
Instructional Power Cruise Speed
(50% power, sea level) 100 (102%)

Fuel Consumption (gal per hr 75%) 8.4

Fuel Consumption (gal per hr 50%) 5.6
*WITH FENDERS INSTALLED`;
    expect(values(page)).toEqual({
      serviceCeilingFt: 14300, climbTasKt: 74, cruiseTasKt: 115, cruisePowerPct: 75, fuelBurnGph: 8.4,
    });
    expect(figuresOfPage(page).serviceCeilingFt!.words).toBe("Service Ceiling (ft) 14,300");
  });

  it("gives a Cessna's, its usable fuel off the capacity line", () => {
    const page = `SPEED:
Maximum at Sea Level ........ 126 KNOTS
Cruise, 75% Power at 8000 Ft ........ 122 KNOTS
RATE OF CLIMB AT SEA LEVEL ........ 730 FPM
SERVICE CEILING ........ 13.500 FT
FUEL CAPACITY: Total 56 GAL. Usable 53 GAL.`;
    expect(values(page)).toEqual({ cruiseTasKt: 122, cruisePowerPct: 75, serviceCeilingFt: 13500, usableFuelGal: 53 });
  });

  it("takes a line's own knots over the miles an hour beside them, and not Vno", () => {
    const page = `Maximum Structural Cruising Speed (Vno) 129 KTS
Cruise, 75% Power at 8000 Ft 122 KTS (140 MPH)
Fuel flow 75% 8.4 gph 65% 7.0 gph`;
    expect(values(page)).toEqual({ cruiseTasKt: 122, cruisePowerPct: 75, fuelBurnGph: 8.4 });
  });

  it("gives nothing off a page with no figures", () => {
    expect(figuresOfPage("NORMAL PROCEDURES\nBefore starting engine, check fuel selector.")).toEqual({});
  });
});
