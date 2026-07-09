//
//  KeyStore.swift
//  FileSync
//
//  Local persistence for room encryption keys, known rooms, the client
//  fingerprint, and the auth session. Room keys never leave the device
//  (only their SHA-256 hash is sent to the server), mirroring the web
//  client's localStorage approach.
//

import Foundation

/// A room this device has created or joined, with its locally-held key.
struct KnownRoom: Codable, Identifiable, Equatable, Hashable {
    var code: String       // 4-digit room code (also the Identifiable id)
    var serverId: String   // server room id (used for chat/file endpoints)
    var keyHex: String     // 32-byte AES key, hex-encoded
    var createdAt: Date

    init(code: String, serverId: String, keyHex: String, createdAt: Date = Date()) {
        self.code = code
        self.serverId = serverId
        self.keyHex = keyHex
        self.createdAt = createdAt
    }

    var id: String { code }
    var key: Data { Data(hexString: keyHex) ?? Data() }
    var shareString: String { Crypto.encodeShareString(roomCode: code, key: key) }
}

/// Persisted auth session.
struct StoredSession: Codable {
    var token: String
    var accountType: String
    var scope: String
}

enum KeyStore {
    private static let defaults = UserDefaults.standard
    private static let fingerprintKey = "epheia_client_fingerprint"
    private static let roomsKey = "filesync_known_rooms"
    private static let serverKey = "filesync_server_url"
    private static let sessionKey = "filesync_session"

    // MARK: Fingerprint

    static func clientFingerprint() -> String {
        if let existing = defaults.string(forKey: fingerprintKey) { return existing }
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let fp = bytes.map { String(format: "%02x", $0) }.joined()
        defaults.set(fp, forKey: fingerprintKey)
        return fp
    }

    // MARK: Server URL

    static func serverURL() -> String { defaults.string(forKey: serverKey) ?? "" }
    static func setServerURL(_ url: String) { defaults.set(url, forKey: serverKey) }

    // MARK: Session

    static func session() -> StoredSession? {
        guard let data = defaults.data(forKey: sessionKey) else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    static func setSession(_ session: StoredSession?) {
        if let session, let data = try? JSONEncoder().encode(session) {
            defaults.set(data, forKey: sessionKey)
        } else {
            defaults.removeObject(forKey: sessionKey)
        }
    }

    // MARK: Known rooms

    static func knownRooms() -> [KnownRoom] {
        guard let data = defaults.data(forKey: roomsKey) else { return [] }
        return (try? JSONDecoder().decode([KnownRoom].self, from: data)) ?? []
    }

    static func saveKnownRooms(_ rooms: [KnownRoom]) {
        if let data = try? JSONEncoder().encode(rooms) {
            defaults.set(data, forKey: roomsKey)
        }
    }

    static func upsertRoom(_ room: KnownRoom) {
        var rooms = knownRooms()
        if let idx = rooms.firstIndex(where: { $0.code == room.code }) {
            rooms[idx] = room
        } else {
            rooms.insert(room, at: 0)
        }
        saveKnownRooms(rooms)
    }

    static func removeRoom(code: String) {
        saveKnownRooms(knownRooms().filter { $0.code != code })
    }

    static func room(forCode code: String) -> KnownRoom? {
        knownRooms().first { $0.code == code }
    }
}

// MARK: - Hex helpers

extension Data {
    init?(hexString: String) {
        let chars = Array(hexString)
        guard chars.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let byte = UInt8(String(chars[i...i+1]), radix: 16) else { return nil }
            bytes.append(byte)
            i += 2
        }
        self = Data(bytes)
    }

    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
