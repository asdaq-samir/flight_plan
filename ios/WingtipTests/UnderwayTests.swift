import Foundation
import Testing
@testable import Wingtip

/// The phone's flying-speed line and the variation's side, held to the
/// engine's 40 kt (motion/glide.rs) and the planner's east-positive sign.
struct UnderwayTests {
    @Test func flyingStartsAtFortyKnotsAndNoSpeedIsNotFlying() {
        #expect(!Flight.underway(39))
        #expect(Flight.underway(40))
        #expect(!Flight.underway(nil))
    }

    @Test func variationReadsEastWhenPositiveAndWestWhenNegative() {
        #expect(Flight.variationSide(1).letter == "E")
        #expect(Flight.variationSide(1).word == "east")
        #expect(Flight.variationSide(-1).letter == "W")
        #expect(Flight.variationSide(-1).word == "west")
    }
}
