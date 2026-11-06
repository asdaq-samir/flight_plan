import XCTest

/// The flows a pilot takes first, driven through the app as Apple's UI
/// testing drives one, on the runner beside LaunchTests: a route planned
/// from the FPL tab and its nav log shown, a field's card opened from the
/// search, and the Brief opened. Each asks the planner the build is
/// pointed at (WINGTIP_HOST, native-ios.yml), so the waits are long and
/// the asserts ask only that the screen came, not what it said -- the
/// planner's own tests hold its figures. Launched with -fresh, so a
/// route the simulator kept from the last run does not fill the fields.
///
/// The handles are the accessibility identifiers in the files this
/// pass could add them to (an airport result, the card's head, the
/// Brief) and the labels the a11y pass gave the rest: FPL's From and To
/// fields and its Plan button are matched by their words, and the Brief
/// glyph by its label "Brief" (or "Brief, VFR flight not recommended"),
/// since FPLView is another session's file.
final class FlowTests: XCTestCase {
    /// How long a planner answer may take on the runner, s.
    private static let planner: TimeInterval = 120

    @MainActor
    private func launch(tab: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-tab", tab, "-fresh"]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "the app did not come to the foreground")
        return app
    }

    /// A route typed into FPL and planned: C81 to KDLH, the planner's
    /// own test route.
    @MainActor
    private func plan(_ app: XCUIApplication) {
        let from = app.textFields["From"]
        XCTAssertTrue(from.waitForExistence(timeout: 30), "no From field")
        from.tap()
        from.typeText("C81")
        let to = app.textFields["To"]
        XCTAssertTrue(to.waitForExistence(timeout: 10), "no To field")
        to.tap()
        to.typeText("KDLH")
        let plan = app.buttons["Plan"]
        XCTAssertTrue(plan.waitForExistence(timeout: 10), "no Plan button")
        plan.tap()
    }

    @MainActor
    private func keep(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    @MainActor
    func testARouteIsPlannedAndItsNavLogShown() throws {
        let app = launch(tab: "fpl")
        plan(app)
        // The nav log's section, "Nav log" or "Nav log · 4,500 ft", once
        // the planner has streamed the legs.
        let navLog = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Nav log'")).firstMatch
        XCTAssertTrue(navLog.waitForExistence(timeout: Self.planner), "the nav log did not appear")
        keep(app, "nav log")
    }

    @MainActor
    func testAnAirportsCardOpensFromTheSearch() throws {
        let app = launch(tab: "airport")
        // The system's search field in the sheet; a row's own field in the
        // iPad's sidebar (AirportSearchView, AirportQuery.prompt).
        let search = app.searchFields.firstMatch.waitForExistence(timeout: 30) ? app.searchFields.firstMatch : app.textFields["Identifier, name or town"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), "no search field")
        search.tap()
        search.typeText("KDLH")
        let result = app.descendants(matching: .any)["airport-result-KDLH"]
        XCTAssertTrue(result.waitForExistence(timeout: Self.planner), "KDLH was not found")
        result.tap()
        let head = app.descendants(matching: .any)["airport-card-head"]
        XCTAssertTrue(head.waitForExistence(timeout: Self.planner), "the card did not open")
        keep(app, "airport card")
    }

    @MainActor
    func testTheBriefOpens() throws {
        let app = launch(tab: "fpl")
        plan(app)
        // The Brief glyph beside the altitude, there as soon as both ends
        // are typed; its label says when VFR is not recommended.
        let brief = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Brief'")).firstMatch
        XCTAssertTrue(brief.waitForExistence(timeout: Self.planner), "no Brief button")
        brief.tap()
        XCTAssertTrue(app.navigationBars["Brief"].waitForExistence(timeout: Self.planner), "the Brief did not open")
        keep(app, "brief")
    }
}
