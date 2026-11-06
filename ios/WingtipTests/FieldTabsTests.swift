import Foundation
import Testing
@testable import Wingtip

/// Where the field-tabs layout sends each screen's word
/// (FieldTabsSheetView.Home): the tabs' own homes where the tabs have
/// one, the Airport tab's lists, a page of its own for what the tabs
/// reach only from inside, and words for what lives elsewhere.
struct FieldTabsHomeTests {
    @Test func theTabsOwnScreensAreTabs() {
        #expect(FieldTabsSheetView.Home.of(.airplane) == .tab(.aircraft))
        #expect(FieldTabsSheetView.Home.of(.settings) == .tab(.setup))
        #expect(FieldTabsSheetView.Home.of(.routes) == .tab(.fpl))
    }

    @Test func theAirportTabsListsAreItsOwn() {
        #expect(FieldTabsSheetView.Home.of(.nearest) == .list(.nearest))
        #expect(FieldTabsSheetView.Home.of(.favorites) == .list(.favorites))
        #expect(FieldTabsSheetView.Home.of(.recents) == .list(.recents))
        // The stops are the website's for now: the nearest fields stand in.
        #expect(FieldTabsSheetView.Home.of(.fuel) == .list(.nearest))
        #expect(FieldTabsSheetView.Home.of(.food) == .list(.nearest))
        #expect(FieldTabsSheetView.Home.of(.stops) == .list(.nearest))
    }

    @Test func whatTheTabsReachOnlyFromInsideIsAPage() {
        #expect(FieldTabsSheetView.Home.of(.brief) == .page(.brief))
        #expect(FieldTabsSheetView.Home.of(.navlog) == .page(.navlog))
        #expect(FieldTabsSheetView.Home.of(.logbook) == .page(.logbook))
        #expect(FieldTabsSheetView.Home.of(.instructor) == .page(.instructor))
        #expect(FieldTabsSheetView.Home.of(.altitude) == .page(.profile))
        #expect(FieldTabsSheetView.Home.of(.profile) == .page(.profile))
        #expect(FieldTabsSheetView.Home.of(.dryrun) == .page(.profile))
        #expect(FieldTabsSheetView.Home.of(.procedures) == .page(.procedures))
        #expect(FieldTabsSheetView.Home.of(.file) == .page(.file))
        #expect(FieldTabsSheetView.Home.of(.clearance) == .page(.clearance))
        #expect(FieldTabsSheetView.Home.of(.radio) == .page(.clearance))
        #expect(FieldTabsSheetView.Home.of(.saved) == .page(.flights))
        #expect(FieldTabsSheetView.Home.of(.recentRoutes) == .page(.flights))
    }

    @Test func whatLivesElsewhereIsSaidInWords() {
        for screen in [FieldScreen.share, .map] {
            guard case .words(let words) = FieldTabsSheetView.Home.of(screen) else {
                Issue.record("\(screen) has no words")
                continue
            }
            #expect(!words.isEmpty)
        }
    }

    @Test func everyScreenHasAHome() {
        // Exhaustive by the switch; this keeps a new word from being
        // added to FieldScreen without a home here being thought about.
        for screen in FieldScreen.allCases {
            _ = FieldTabsSheetView.Home.of(screen)
        }
    }
}
