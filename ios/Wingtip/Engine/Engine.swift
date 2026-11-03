import Foundation
import WingtipEngine

/// wingtip-engine, the planner's own Rust, through its C functions
/// (native/ffi): the same figures the planner works out, here with no
/// network. Each pack is handed over mapped for the call alone.
enum Engine {
    /// The planner's AirspaceAt for a point, from the region's phone pack
    /// (nil for a region with no pack: nothing is drawn there), as
    /// /api/airspace/at answers it but for what a pack cannot hold -- the
    /// ground's height, the TFRs, the fix the point is named off. Nil where
    /// the bytes are not a pack the engine reads.
    static func airspaceAt(pack: Data?, lat: Double, lon: Double, groundFt: Double? = nil) -> AirspaceAt? {
        let ground = groundFt ?? .nan
        let answer: UnsafeMutablePointer<CChar>?
        if let pack, !pack.isEmpty {
            answer = pack.withUnsafeBytes { raw in
                wt_airspace_at(raw.bindMemory(to: UInt8.self).baseAddress, raw.count, lat, lon, ground)
            }
        } else {
            answer = wt_airspace_at(nil, 0, lat, lon, ground)
        }
        guard let json = taken(answer) else { return nil }
        return try? Planner.snakeCase.decode(AirspaceAt.self, from: Data(json.utf8))
    }

    /// Whether every byte of a pack is as the planner wrote it.
    static func verify(_ pack: Data) -> Bool {
        pack.withUnsafeBytes { raw in wt_pack_verify(raw.bindMemory(to: UInt8.self).baseAddress, raw.count) } == 1
    }

    /// The region whose pack holds a point ("n40w088").
    static func region(lat: Double, lon: Double) -> String {
        taken(wt_region_of(lat, lon)) ?? ""
    }

    /// What the radio said, all the phone can make of it with no signal
    /// (wingtip_engine::spoken::hear): the clearance read into its items,
    /// whether it was said to `tail`, where its "direct" sends us, the
    /// places it named found in the kept packs, and the route it gives
    /// from the one planned. Its SID and STAR are the planner's to find.
    struct Heard: Decodable {
        struct Route: Decodable, Equatable { let dep: String; let stops: [String]; let dest: String }
        let clearance: Clearance
        let forUs: Bool
        let direct: String?
        let directFound: ClearancePlaces.Place?
        let found: ClearancePlaces
        let route: Route
        let typed: [Clearance.Typed]
    }

    static func hear(_ heard: String, tail: String?, packs: [Data], near: [(Double, Double)],
                     dep: String, stops: [String], dest: String) -> Heard? {
        let lats = near.map(\.0), lons = near.map(\.1)
        // Each pack's bytes held for the call, as one array of pointers.
        func with(_ i: Int, _ pointers: [UnsafePointer<UInt8>?], _ lens: [Int], _ body: ([UnsafePointer<UInt8>?], [Int]) -> String?) -> String? {
            guard i < packs.count else { return body(pointers, lens) }
            return packs[i].withUnsafeBytes { raw in
                with(i + 1, pointers + [raw.bindMemory(to: UInt8.self).baseAddress], lens + [raw.count], body)
            }
        }
        let json = with(0, [], []) { pointers, lens in
            taken(wt_clearance_hear(heard, tail, pointers, lens, packs.count, lats, lons, near.count,
                                    dep, stops.joined(separator: ","), dest))
        }
        guard let json else { return nil }
        return try? JSONDecoder().decode(Heard.self, from: Data(json.utf8))
    }

    // MARK: - Any rule by its name

    /// What the engine said was wrong with a call, in its own words (a
    /// name it has no rule for, an input not of the rule's shape).
    struct Refused: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// A rule of the engine by its name, as the web app's callEngine and
    /// the planner's vfr_native.call ask it (wt_call): one way in, so a
    /// rule moved into the engine needs no new C function. call.rs lists
    /// every name with its input's keys, which are the rule's own --
    /// mostly snake case, camel case where the gateway's are -- so the
    /// input is encoded as written unless the caller says otherwise, and
    /// the answer decoded with the decoder the rule's keys want.
    static func call<Out: Decodable>(_ name: String, _ input: some Encodable, encoder: JSONEncoder = JSONEncoder(),
                                     decoder: JSONDecoder = JSONDecoder()) throws -> Out {
        let asked = String(decoding: try encoder.encode(input), as: UTF8.self)
        return try decoder.decode(Out.self, from: Data(try called(name, asked).utf8))
    }

    /// The same with the input as a JSON object written out in place, for
    /// an input with members of several types; nil is JSON's null, which
    /// the engine reads as a member left out.
    static func call<Out: Decodable>(_ name: String, json input: [String: Any?], decoder: JSONDecoder = JSONDecoder()) throws -> Out {
        try decoder.decode(Out.self, from: Data(try called(name, written(input)).utf8))
    }

    /// The answer as JSONSerialization reads it, for an answer with no
    /// fixed shape worth a type.
    static func callJSON(_ name: String, _ input: [String: Any?]) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(try called(name, written(input)).utf8), options: .fragmentsAllowed)
    }

    /// The engine's answer as text, or its complaint thrown.
    private static func called(_ name: String, _ input: String) throws -> String {
        let answer = wt_call(name, input)
        guard let text = taken(answer.text) else { throw Refused(message: "\(name): the engine gave no answer") }
        guard answer.ok == 1 else { throw Refused(message: text) }
        return text
    }

    /// An object of Swift values as JSON text. JSONSerialization raises an
    /// Objective-C exception, which Swift cannot catch, on what JSON cannot
    /// hold (a NaN), so the object is checked first.
    private static func written(_ input: [String: Any?]) throws -> String {
        let object = plain(input)
        guard JSONSerialization.isValidJSONObject(object) else { throw Refused(message: "The engine's input is not JSON: \(input)") }
        return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    /// A value with every nil inside it, at any depth, made NSNull.
    private static func plain(_ value: Any?) -> Any {
        guard let value else { return NSNull() }
        if let optional = value as? AnyOptional { return plain(optional.unwrapped) }
        if let object = value as? [String: Any?] { return object.mapValues { plain($0) } }
        if let object = value as? [String: Any] { return object.mapValues { plain($0) } }
        if let list = value as? [Any?] { return list.map { plain($0) } }
        if let list = value as? [Any] { return list.map { plain($0) } }
        return value
    }

    /// A string the engine returned, read and given back.
    private static func taken(_ pointer: UnsafeMutablePointer<CChar>?) -> String? {
        guard let pointer else { return nil }
        defer { wt_string_free(pointer) }
        return String(cString: pointer)
    }
}

/// An Optional seen through Any, so Engine.plain can unwrap one nested
/// in an array or an object.
private protocol AnyOptional {
    var unwrapped: Any? { get }
}

extension Optional: AnyOptional {
    fileprivate var unwrapped: Any? { map { $0 as Any } }
}
