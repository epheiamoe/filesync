//
//  APIClient.swift
//  FileSync
//
//  Typed async wrapper around the FileSync Worker REST API.
//  Mirrors packages/frontend/src/lib/api.ts. Auth is a Bearer token.
//

import Foundation

struct APIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
    var isUnauthorized: Bool { status == 401 }
}

/// Minimal type eraser so request bodies can be passed as `any Encodable`.
struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init<T: Encodable>(_ wrapped: T) { encodeFunc = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFunc(encoder) }
}

final class APIClient {
    var serverURL: String   // origin, e.g. "https://filesync-api.example.workers.dev"
    var token: String?

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(serverURL: String = "", token: String? = nil) {
        self.serverURL = serverURL
        self.token = token

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    private var apiBase: String {
        var s = serverURL.trimmingCharacters(in: .whitespaces)
        if s.hasSuffix("/") { s.removeLast() }
        return s + "/api"
    }

    /// WebSocket origin, e.g. "wss://filesync-api.example.workers.dev".
    var wsOrigin: String {
        var s = serverURL.trimmingCharacters(in: .whitespaces)
        if s.hasSuffix("/") { s.removeLast() }
        if s.hasPrefix("https://") { return "wss://" + s.dropFirst("https://".count) }
        if s.hasPrefix("http://") { return "ws://" + s.dropFirst("http://".count) }
        return s
    }

    // MARK: - Core request

    private func makeRequest(_ method: String, _ path: String, body: Data?, contentType: String?) -> URLRequest {
        var req = URLRequest(url: URL(string: apiBase + path)!)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        return req
    }

    private func rawRequest(_ method: String, _ path: String, body: Data? = nil, contentType: String? = "application/json") async throws -> (Data, HTTPURLResponse) {
        let req = makeRequest(method, path, body: body, contentType: contentType)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError(status: 0, code: "NETWORK_ERROR", message: error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "NETWORK_ERROR", message: "无效的响应")
        }
        if !(200...299).contains(http.statusCode) {
            var code = "UNKNOWN_ERROR"
            var message = "HTTP \(http.statusCode)"
            if let parsed = try? decoder.decode(APIResponse<Empty>.self, from: data) {
                message = parsed.error ?? message
                code = parsed.code ?? code
            }
            throw APIError(status: http.statusCode, code: code, message: message)
        }
        return (data, http)
    }

    /// Send a JSON request and return the unwrapped `data` field of the API envelope.
    @discardableResult
    private func call<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T {
        let encodedBody = try body.map { try encoder.encode(AnyEncodable($0)) }
        let (data, _) = try await rawRequest(method, path, body: encodedBody)
        let envelope = try decoder.decode(APIResponse<T>.self, from: data)
        guard envelope.success, let value = envelope.data else {
            throw APIError(status: 200, code: envelope.code ?? "NO_DATA",
                           message: envelope.error ?? "服务器未返回数据")
        }
        return value
    }

    // MARK: - Auth

    func login(method: LoginMethod, credentials: [String: String]) async throws -> LoginResponse {
        var body = credentials
        body["method"] = method.rawValue
        return try await call("POST", "/auth/login", body: body)
    }

    func logout() async {
        _ = try? await rawRequest("POST", "/auth/logout")
    }

    func validateSession() async throws -> Bool {
        struct SessionCheck: Decodable { let valid: Bool }
        let res: SessionCheck = try await call("GET", "/auth/session")
        return res.valid
    }

    // MARK: - Rooms

    func createRoom(keyHash: String, roomCode: String?) async throws -> CreateRoomResponse {
        struct Body: Encodable { let keyHash: String; let roomCode: String? }
        return try await call("POST", "/rooms", body: Body(keyHash: keyHash, roomCode: roomCode))
    }

    func joinRoom(roomCode: String, keyHash: String, deviceLabel: String, fingerprint: String) async throws -> JoinRoomResponse {
        struct Body: Encodable {
            let roomCode: String; let keyHash: String
            let deviceLabel: String; let clientFingerprint: String
        }
        return try await call("POST", "/rooms/join",
                              body: Body(roomCode: roomCode, keyHash: keyHash,
                                         deviceLabel: deviceLabel, clientFingerprint: fingerprint))
    }

    func listRooms(fingerprint: String?) async throws -> [RoomInfo] {
        struct Wrapper: Decodable { let rooms: [RoomInfo] }
        var path = "/rooms"
        if let fingerprint, let enc = fingerprint.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?client_fingerprint=\(enc)"
        }
        let res: Wrapper = try await call("GET", path)
        return res.rooms
    }

    func getRoomInfo(code: String) async throws -> RoomInfo {
        try await call("GET", "/rooms/\(code)")
    }

    // MARK: - Chat

    func getMessages(roomId: String, before: String? = nil, limit: Int = 50) async throws -> ChatMessagesResponse {
        var comps = URLComponents()
        comps.queryItems = [
            URLQueryItem(name: "room_id", value: roomId),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let before { comps.queryItems?.append(URLQueryItem(name: "before", value: before)) }
        return try await call("GET", "/chat/messages\(comps.percentEncodedQuery.map { "?\($0)" } ?? "")")
    }

    func sendMessage(roomId: String, encryptedContent: String, messageType: String = "text",
                     deviceLabel: String, ttlSeconds: Int?) async throws -> SendMessageResponse {
        struct Body: Encodable {
            let roomId: String; let encryptedContent: String
            let messageType: String; let deviceLabel: String; let ttlSeconds: Int?
        }
        return try await call("POST", "/chat/messages",
                              body: Body(roomId: roomId, encryptedContent: encryptedContent,
                                         messageType: messageType, deviceLabel: deviceLabel, ttlSeconds: ttlSeconds))
    }

    func recallMessage(messageId: String, roomId: String) async throws {
        struct Body: Encodable { let roomId: String }
        let _: Empty = try await call("DELETE", "/chat/messages/\(messageId)", body: Body(roomId: roomId))
    }

    // MARK: - Files

    func listFiles(roomId: String) async throws -> FileListResponse {
        try await call("GET", "/files/room/\(roomId)?")
    }

    func initUpload(filename: String, totalSize: Int, chunkSize: Int, roomId: String,
                    visibility: String, expiresAt: String) async throws -> UploadInitResponse {
        struct Body: Encodable {
            let filename: String; let totalSize: Int; let chunkSize: Int
            let roomId: String; let visibility: String; let expiresAt: String
        }
        return try await call("POST", "/files/upload/init",
                              body: Body(filename: filename, totalSize: totalSize, chunkSize: chunkSize,
                                         roomId: roomId, visibility: visibility, expiresAt: expiresAt))
    }

    func uploadPart(uploadId: String, partNumber: Int, chunk: Data) async throws -> UploadPartResponse {
        let boundary = "----FileSyncBoundary\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.append("\(value)\r\n")
        }
        field("upload_id", uploadId)
        field("part_number", String(partNumber))
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"chunk\"; filename=\"chunk\"\r\n")
        body.append("Content-Type: application/octet-stream\r\n\r\n")
        body.append(chunk)
        body.append("\r\n--\(boundary)--\r\n")

        let (data, _) = try await rawRequest("POST", "/files/upload/part", body: body,
                                             contentType: "multipart/form-data; boundary=\(boundary)")
        let envelope = try decoder.decode(APIResponse<UploadPartResponse>.self, from: data)
        guard let value = envelope.data else {
            throw APIError(status: 200, code: "NO_DATA", message: "分块上传失败")
        }
        return value
    }

    func completeUpload(uploadId: String, r2Key: String, parts: [UploadPartResponse],
                        encryptedFilename: String, fileSize: Int, mimeType: String,
                        visibility: String, expiresAt: String, roomId: String,
                        fileHash: String?) async throws -> UploadCompleteResponse {
        struct Part: Encodable { let etag: String; let partNumber: Int }
        struct Body: Encodable {
            let uploadId: String; let r2Key: String; let parts: [Part]
            let encryptedFilename: String; let fileSize: Int; let mimeType: String
            let visibility: String; let expiresAt: String; let roomId: String; let fileHash: String?
        }
        let body = Body(uploadId: uploadId, r2Key: r2Key,
                        parts: parts.map { Part(etag: $0.etag, partNumber: $0.partNumber) },
                        encryptedFilename: encryptedFilename, fileSize: fileSize, mimeType: mimeType,
                        visibility: visibility, expiresAt: expiresAt, roomId: roomId, fileHash: fileHash)
        return try await call("POST", "/files/upload/complete", body: body)
    }

    func abortUpload(uploadId: String) async {
        struct Body: Encodable { let uploadId: String }
        let _: Empty? = try? await call("POST", "/files/upload/abort", body: Body(uploadId: uploadId))
    }

    /// Download raw file bytes. Returns bytes plus whether the content is E2E-encrypted.
    func downloadFile(fileId: String) async throws -> (data: Data, encrypted: Bool) {
        let (data, http) = try await rawRequest("GET", "/files/\(fileId)/download", contentType: nil)
        let encrypted = (http.value(forHTTPHeaderField: "X-File-Encrypted") == "true")
        return (data, encrypted)
    }

    func recallFile(fileId: String) async throws {
        let _: Empty = try await call("DELETE", "/files/\(fileId)")
    }

    // MARK: - WebSocket ticket

    func wsTicket(roomCode: String) async throws -> String {
        let t = token ?? ""
        let path = "/ws?room=\(roomCode.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? roomCode)&token=\(t.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? t)"
        let res: WsTicketResponse = try await call("GET", path)
        return res.ticket
    }

    // MARK: - Admin

    func adminStats() async throws -> AdminStats {
        try await call("GET", "/admin/stats")
    }
}

private extension Data {
    mutating func append(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
