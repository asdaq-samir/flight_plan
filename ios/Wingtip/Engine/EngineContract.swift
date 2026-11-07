// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let engineTrafficMarksAnswer = try? JSONDecoder().decode(EngineTrafficMarksAnswer.self, from: jsonData)
//   let engineAlertFiresAnswer = try? JSONDecoder().decode(EngineAlertFiresAnswer.self, from: jsonData)
//   let engineAltitudeLinesAnswer = try? JSONDecoder().decode(EngineAltitudeLinesAnswer.self, from: jsonData)

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

import Foundation

// MARK: - EngineTrafficMarksAnswerElement
struct EngineTrafficMarksAnswerElement: Codable, Equatable, Sendable {
    let label: String
    let near: Bool
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - EngineAlertFiresAnswer
struct EngineAlertFiresAnswer: Codable, Equatable, Sendable {
    /// True bearing from the place to the airplane.
    let bearingDeg: Double?
    let fires: Bool
    /// Near something: whether it is that near now; null for the others.
    let inside: Bool?
    let nm: Double?

    enum CodingKeys: String, CodingKey {
        case bearingDeg = "bearing_deg"
        case fires, inside, nm
    }
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - EngineAltitudeLinesAnswer
struct EngineAltitudeLinesAnswer: Codable, Equatable, Sendable {
    let crossing: EngineCrossing?
    let lines: [EngineLine]
}

enum EngineCrossing: String, Codable, Equatable, Sendable {
    case at = "at"
    case atOrAbove = "at_or_above"
    case atOrBelow = "at_or_below"
    case between = "between"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - EngineLine
struct EngineLine: Codable, Equatable, Sendable {
    let ft: Double
    let over, under: Bool
}

typealias EngineTrafficMarksAnswer = [EngineTrafficMarksAnswerElement]
