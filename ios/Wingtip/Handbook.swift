import Foundation
import UIKit
import Vision

/// The planning figures on a handbook's specifications page, read off a
/// photo of it on the phone: Apple's Vision reads the words (no key, no
/// server, works offline), and the engine's `handbook_figures` (the web
/// app's lib/handbookText) finds the figures by their labels, in knots
/// where the page prints mph. Each comes with the line
/// it was read from, for the pilot to check against the page before
/// saving; one the page does not label plainly is not guessed.
enum Handbook {
    struct Figure: Equatable, Sendable, Decodable {
        let value: Double
        let words: String
    }

    /// The engine's answer, camel case: a figure the page does not label
    /// plainly is left out.
    struct Figures: Equatable, Sendable, Decodable {
        var cruiseTasKt: Figure?
        var cruisePowerPct: Figure?
        var fuelBurnGph: Figure?
        var usableFuelGal: Figure?
        var climbTasKt: Figure?
        var serviceCeilingFt: Figure?

        var isEmpty: Bool { cruiseTasKt == nil && cruisePowerPct == nil && fuelBurnGph == nil && usableFuelGal == nil && climbTasKt == nil && serviceCeilingFt == nil }
        var words: [String] { [cruiseTasKt, cruisePowerPct, fuelBurnGph, usableFuelGal, climbTasKt, serviceCeilingFt].compactMap { $0?.words } }
    }

    /// The words on the page, top to bottom, one line each.
    static func read(_ image: UIImage) async throws -> String {
        guard let cg = image.cgImage else { return "" }
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let observations = try await request.perform(on: cg, orientation: .up)
        // Top to bottom: Vision's boxes have their origin at the bottom.
        return observations.sorted { $0.boundingBox.origin.y > $1.boundingBox.origin.y }
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    /// The figures on the page's text; none where the engine cannot
    /// answer, which is never for text.
    static func figures(of text: String) -> Figures {
        let found: Figures? = try? Engine.call("handbook_figures", ["text": text])
        return found ?? Figures()
    }
}
