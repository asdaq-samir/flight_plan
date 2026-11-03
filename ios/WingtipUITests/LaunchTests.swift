import XCTest

/// The app launched and on its feet, as Apple's own UI testing runs a
/// flow: the one smoke test the macOS runner adds to the unit tests, so
/// a build that compiles but cannot show its first screen is caught on
/// CI before a phone sees it (the owner's ask, 2026-11-03, after the
/// review of the app against Apple's guidance). The flows a pilot sees
/// are the web app's Playwright specs until this app is the product.
final class LaunchTests: XCTestCase {
    @MainActor
    func testTheAppLaunchesToItsMap() throws {
        let app = XCUIApplication()
        // Opened on the plan tab with no account: the first screen is the
        // chart under the sheet (RootView), whatever the pilot last had.
        app.launchArguments += ["-tab", "fpl"]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "the app did not come to the foreground")
        // A sheet or a side column is up within a few seconds; either has
        // text the pilot reads. The exact words change with the product,
        // so the test asks only that something readable is on screen.
        let anyText = app.staticTexts.firstMatch
        XCTAssertTrue(anyText.waitForExistence(timeout: 20), "no text on the first screen")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "first screen"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
