//
//  Models.swift
//  FileSync
//
//  Codable DTOs mirroring the FileSync Worker API (packages/shared/src/types.ts).
//  The JSON uses snake_case; decoding/encoding uses `.convertFrom/ToSnakeCase`,
//  so property names here stay camelCase.
//

import Foundation

// MARK: - Standard response wrapper

struct APIResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: T?
    let error: String?
    let code: String?
}

/// Placeholder for endpoints whose `data` payload we don't need to parse.
struct Empty: Decodable {}

// MARK: - Auth

enum LoginMethod: String, CaseIterable, Identifiable {
    case admin
    case apiKey = "api_key"
    case tempCredential = "temp_credential"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .admin: return "管理员"
        case .apiKey: return "API 密钥"
        case .tempCredential: return "临时口令"
        }
    }
}

struct LoginResponse: Decodable {
    let token: String
    let accountType: String
    let scope: String
    let expiresAt: String?
}

// MARK: - Rooms

struct CreateRoomResponse: Decodable {
    let id: String
    let roomCode: String
    let createdAt: String?
}

struct JoinRoomResponse: Decodable {
    let success: Bool?
    let roomId: String?
}

struct RoomInfo: Decodable, Identifiable {
    let id: String
    let roomCode: String
    let createdAt: String?
    let memberCount: Int?
}

// MARK: - Chat

enum MessageType: String, Codable {
    case text
    case fileShared = "file_shared"
    case system
}

struct MessageDTO: Decodable, Identifiable, Equatable {
    let id: String
    let roomId: String
    let senderSessionId: String
    let encryptedContent: String
    let messageType: String
    let deviceLabel: String?
    let recalledAt: String?
    let ttlSeconds: Int?
    let expiresAt: String?
    let createdAt: String

    static func == (lhs: MessageDTO, rhs: MessageDTO) -> Bool { lhs.id == rhs.id }
}

struct ChatMessagesResponse: Decodable {
    let messages: [MessageDTO]
    let nextCursor: String?
}

struct SendMessageResponse: Decodable {
    let messageId: String
    let createdAt: String
}

// MARK: - Files

enum FileVisibility: String, Codable {
    case `private`
    case `public`
}

struct FileMetaDTO: Decodable, Identifiable, Equatable {
    let id: String
    let roomId: String
    let uploaderSessionId: String
    let encryptedFilename: String
    let encryptedMeta: String?
    let fileSize: Int
    let mimeType: String
    let visibility: String
    let expiresAt: String
    let recalledAt: String?
    let createdAt: String
    let fileHash: String?

    static func == (lhs: FileMetaDTO, rhs: FileMetaDTO) -> Bool { lhs.id == rhs.id }
}

struct FileListResponse: Decodable {
    let files: [FileMetaDTO]
    let cursor: String?
}

struct UploadInitResponse: Decodable {
    let uploadId: String
    let r2Key: String
    let chunksNeeded: Int
}

struct UploadPartResponse: Decodable {
    let etag: String
    let partNumber: Int
}

struct UploadCompleteResponse: Decodable {
    let fileId: String
}

// MARK: - WebSocket

struct WsTicketResponse: Decodable {
    let ticket: String
}

// MARK: - Admin

struct AdminStats: Decodable {
    let r2TotalBytes: Int
    let r2FileCount: Int
    let roomCount: Int
    let activeSessions: Int
}
