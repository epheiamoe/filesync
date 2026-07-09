//
//  Crypto.swift
//  FileSync
//
//  End-to-end encryption layer — a byte-for-byte port of the web client's
//  `packages/frontend/src/lib/crypto.ts` so that rooms, messages and files
//  created on the web are fully interoperable with this iOS client.
//
//  Scheme:
//   - Room key: 32 random bytes (AES-256).
//   - key_hash: SHA-256(key) hex — sent to the server for verification.
//     The raw key NEVER leaves the device.
//   - Share string: "{roomCode}-{key in Crockford base32, groups of 4}".
//   - Content: AES-256-GCM, wire format = iv(12) ‖ ciphertext ‖ tag(16).
//     Text is base64 of that combined buffer.
//

import Foundation
import CryptoKit

enum Crypto {

    // Crockford Base32 alphabet (no I, L, O, U to avoid confusion).
    private static let crockford = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    // MARK: - Key generation

    /// Generate a cryptographically secure 32-byte room key.
    nonisolated static func generateRoomKey() -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    // MARK: - Hashing

    /// SHA-256 of the raw key, hex-encoded. Used for server-side verification.
    nonisolated static func hashKey(_ key: Data) -> String {
        let digest = SHA256.hash(data: key)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// SHA-256 of arbitrary data, hex-encoded. Used for file-integrity checks.
    nonisolated static func fileHash(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - AES-256-GCM

    /// Encrypt and return the combined `iv(12) ‖ ciphertext ‖ tag(16)` buffer.
    nonisolated static func encrypt(_ plaintext: Data, key: Data) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        let sealed = try AES.GCM.seal(plaintext, using: symmetricKey)
        // `.combined` is exactly nonce(12) ‖ ciphertext ‖ tag(16).
        guard let combined = sealed.combined else {
            throw CryptoError.encryptionFailed
        }
        return combined
    }

    /// Decrypt a combined `iv(12) ‖ ciphertext ‖ tag(16)` buffer.
    nonisolated static func decrypt(_ combined: Data, key: Data) throws -> Data {
        guard combined.count >= 28 else { throw CryptoError.combinedTooShort }
        let symmetricKey = SymmetricKey(data: key)
        let box = try AES.GCM.SealedBox(combined: combined)
        return try AES.GCM.open(box, using: symmetricKey)
    }

    /// Encrypt a UTF-8 string and return base64 of the combined buffer.
    nonisolated static func encryptText(_ text: String, key: Data) throws -> String {
        let combined = try encrypt(Data(text.utf8), key: key)
        return combined.base64EncodedString()
    }

    /// Decrypt a base64-encoded combined buffer back to a UTF-8 string.
    nonisolated static func decryptText(_ base64: String, key: Data) throws -> String {
        guard let combined = Data(base64Encoded: base64) else {
            throw CryptoError.invalidBase64
        }
        let plaintext = try decrypt(combined, key: key)
        guard let text = String(data: plaintext, encoding: .utf8) else {
            throw CryptoError.invalidUTF8
        }
        return text
    }

    // MARK: - Share string

    /// Encode "{roomCode}-{keyGroups}" — e.g. "4821-XK7M-A3PQ-...".
    nonisolated static func encodeShareString(roomCode: String, key: Data) -> String {
        let base32 = bytesToBase32(key)
        var groups: [String] = []
        var idx = base32.startIndex
        while idx < base32.endIndex {
            let end = base32.index(idx, offsetBy: 4, limitedBy: base32.endIndex) ?? base32.endIndex
            groups.append(String(base32[idx..<end]))
            idx = end
        }
        return ([roomCode] + groups).joined(separator: "-")
    }

    /// Decode a share string into (roomCode, 32-byte key), or nil if invalid.
    /// Rejects the deprecated 16-char format (which only carried 10 bytes).
    nonisolated static func decodeShareString(_ shareStr: String) -> (roomCode: String, key: Data)? {
        let clean = shareStr.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        guard let dashIdx = clean.firstIndex(of: "-") else { return nil }

        let roomCode = String(clean[clean.startIndex..<dashIdx])
        let keyPart = String(clean[clean.index(after: dashIdx)...])
            .replacingOccurrences(of: "-", with: "")

        // room code: exactly 4 digits.
        guard roomCode.count == 4, roomCode.allSatisfy(\.isNumber) else { return nil }
        guard !keyPart.isEmpty else { return nil }

        let keyBytes = base32ToBytes(keyPart)
        guard keyBytes.count >= 32 else { return nil }  // reject legacy short format
        return (roomCode, keyBytes.prefix(32))
    }

    // MARK: - Base32 (Crockford)

    nonisolated static func bytesToBase32(_ bytes: Data) -> String {
        var result = ""
        var bits = 0
        var value = 0
        for byte in bytes {
            value = (value << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                let index = (value >> bits) & 0x1f
                result.append(crockford[index])
            }
        }
        if bits > 0 {
            let index = (value << (5 - bits)) & 0x1f
            result.append(crockford[index])
        }
        return result
    }

    nonisolated static func base32ToBytes(_ str: String) -> Data {
        var bytes = [UInt8]()
        var bits = 0
        var value = 0
        for ch in str.uppercased() {
            let idx = index(ofCrockford: ch)
            guard idx >= 0 else { continue }
            value = (value << 5) | idx
            bits += 5
            if bits >= 8 {
                bits -= 8
                bytes.append(UInt8((value >> bits) & 0xff))
            }
        }
        return Data(bytes)
    }

    /// Index of a character in the Crockford alphabet, applying the standard
    /// ambiguous-character mappings (I,L→1  O→0  U→V). Returns -1 if unknown.
    private nonisolated static func index(ofCrockford ch: Character) -> Int {
        if let i = crockford.firstIndex(of: ch) { return i }
        switch ch {
        case "I", "L": return 1
        case "O": return 0
        case "U": return crockford.firstIndex(of: "V") ?? -1
        default: return -1
        }
    }
}

enum CryptoError: LocalizedError {
    case encryptionFailed
    case combinedTooShort
    case invalidBase64
    case invalidUTF8

    var errorDescription: String? {
        switch self {
        case .encryptionFailed: return "加密失败"
        case .combinedTooShort: return "密文长度不足"
        case .invalidBase64: return "无效的 Base64 数据"
        case .invalidUTF8: return "无法解码为文本"
        }
    }
}
