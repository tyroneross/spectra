// native/swift/Types.swift
import Foundation

// ─── JSON-RPC Protocol ────────────────────────────────────

struct Request: Decodable {
    let id: Int
    let method: String
    let params: [String: AnyCodableValue]?
}

struct Response: Encodable {
    let id: Int
    let result: AnyCodableValue?
    let error: ResponseError?
}

struct ResponseError: Codable {
    let code: Int
    let message: String
}

// ─── Native Elements ──────────────────────────────────────

struct NativeElement: Codable {
    let role: String
    let label: String
    let value: String?
    let enabled: Bool
    let focused: Bool
    let actions: [String]
    let bounds: [Double]  // [x, y, width, height]
    let path: [Int]       // index path from root for act() targeting
}

struct WindowInfo: Codable {
    let id: Int
    let title: String
    let bounds: [Double]  // [x, y, width, height]
}

struct SnapshotResult: Codable {
    let elements: [NativeElement]
    let window: WindowInfo
}

// ─── Simulator Types ──────────────────────────────────────

struct SimDevice: Codable {
    let udid: String
    let name: String
    let state: String
    let runtime: String
}

// ─── AnyCodableValue ──────────────────────────────────────
// Flexible JSON value type for params and results

enum AnyCodableValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([AnyCodableValue])
    case dictionary([String: AnyCodableValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if let v = try? container.decode([AnyCodableValue].self) { self = .array(v) }
        else if let v = try? container.decode([String: AnyCodableValue].self) { self = .dictionary(v) }
        else if container.decodeNil() { self = .null }
        else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unsupported type")) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .dictionary(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    // Helper accessors
    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }
    var intValue: Int? {
        if case .int(let v) = self { return v }
        return nil
    }
    var doubleValue: Double? {
        if case .double(let v) = self { return v }
        if case .int(let v) = self { return Double(v) }
        return nil
    }
    var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }

    static func from(_ encodable: some Encodable) -> AnyCodableValue {
        guard let data = try? JSONEncoder().encode(encodable),
              let value = try? JSONDecoder().decode(AnyCodableValue.self, from: data) else {
            return .null
        }
        return value
    }
}
