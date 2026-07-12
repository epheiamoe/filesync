//
//  RoomSocket.swift
//  FileSync
//
//  Real-time room connection over WebSocket. Mirrors the two-step handshake
//  from packages/frontend/src/lib/ws.ts:
//    1. GET /api/ws?room=CODE&token=TOKEN  → { ticket }
//    2. Connect wss://origin/api/ws/connect?room=CODE&ticket=TICKET
//    3. Send { event: "subscribe", roomCode, sessionId, deviceLabel }
//  then receive normalized broadcast events.
//

import Foundation
import Combine

enum RoomEvent {
    case chatMessage(MessageDTO)
    case fileShared(FileMetaDTO)
    case recall(messageId: String?, fileId: String?)
    case presence(count: Int)
    case removed(id: String)          // message_expired / file_expired
    case system(action: String?, message: String?)
}

@MainActor
final class RoomSocket: nonisolated ObservableObject {
    @Published private(set) var isConnected = false

    var onEvent: ((RoomEvent) -> Void)?

    private let api: APIClient
    private let roomCode: String
    private let sessionId: String
    private let deviceLabel: String

    private var task: URLSessionWebSocketTask?
    private var closed = false
    private var reconnectAttempts = 0
    private let maxReconnect = 20
    private var heartbeat: Task<Void, Never>?

    init(api: APIClient, roomCode: String, sessionId: String, deviceLabel: String) {
        self.api = api
        self.roomCode = roomCode
        self.sessionId = sessionId
        self.deviceLabel = deviceLabel
    }

    func connect() {
        closed = false
        Task { await connectOnce() }
    }

    func close() {
        closed = true
        heartbeat?.cancel()
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    // MARK: - Connection

    private func connectOnce() async {
        guard !closed else { return }
        do {
            let ticket = try await api.wsTicket(roomCode: roomCode)
            let code = roomCode.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? roomCode
            let tk = ticket.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ticket
            guard let url = URL(string: "\(api.wsOrigin)/api/ws/connect?room=\(code)&ticket=\(tk)") else {
                scheduleReconnect(); return
            }
            let t = URLSession.shared.webSocketTask(with: url)
            task = t
            t.resume()
            sendSubscribe()
            isConnected = true
            reconnectAttempts = 0
            startHeartbeat()
            receiveLoop()
        } catch {
            isConnected = false
            scheduleReconnect()
        }
    }

    private func sendSubscribe() {
        let payload: [String: Any] = [
            "event": "subscribe",
            "roomCode": roomCode,
            "sessionId": sessionId,
            "deviceLabel": deviceLabel,
        ]
        sendJSON(payload)
    }

    private func startHeartbeat() {
        heartbeat?.cancel()
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000) // 25s
                guard let self, !Task.isCancelled else { return }
                self.sendJSON(["event": "ping"])
            }
        }
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(str)) { _ in }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch result {
                case .success(let message):
                    self.handle(message)
                    if !self.closed { self.receiveLoop() }
                case .failure:
                    self.isConnected = false
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func scheduleReconnect() {
        guard !closed, reconnectAttempts < maxReconnect else { return }
        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        reconnectAttempts += 1
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            await self?.connectOnce()
        }
    }

    // MARK: - Inbound parsing

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let s): data = Data(s.utf8)
        case .data(let d): data = d
        @unknown default: return
        }
        guard let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }

        let type = (raw["type"] as? String) ?? (raw["event"] as? String) ?? ""
        let payload = (raw["payload"] as? [String: Any]) ?? (raw["data"] as? [String: Any]) ?? [:]
        let sender = (raw["sender_session_id"] as? String) ?? ""
        let device = (raw["device_label"] as? String) ?? ""
        let timestamp = (raw["timestamp"] as? String) ?? ISO8601DateFormatter().string(from: Date())

        switch type {
        case "chat", "message":
            if let msg = parseMessage(payload, sender: sender, device: device, timestamp: timestamp) {
                onEvent?(.chatMessage(msg))
            }
        case "file_shared":
            if let file = parseFile(payload, sender: sender, timestamp: timestamp) {
                onEvent?(.fileShared(file))
            }
        case "recall":
            let mid = (payload["message_id"] as? String) ?? (payload["id"] as? String)
            let fid = payload["file_id"] as? String
            onEvent?(.recall(messageId: mid, fileId: (fid?.isEmpty == false) ? fid : nil))
        case "presence":
            let members = (payload["members"] as? [[String: Any]]) ?? []
            onEvent?(.presence(count: members.count))
        case "message_expired", "file_expired":
            if let id = (payload["id"] as? String) ?? (payload["message_id"] as? String) ?? (payload["file_id"] as? String) {
                onEvent?(.removed(id: id))
            }
        case "system":
            onEvent?(.system(action: payload["action"] as? String, message: payload["message"] as? String))
        default:
            break
        }
    }

    private func parseMessage(_ p: [String: Any], sender: String, device: String, timestamp: String) -> MessageDTO? {
        let id = (p["id"] as? String) ?? (p["message_id"] as? String) ?? ""
        let content = p["encrypted_content"] as? String ?? ""
        guard !id.isEmpty, !content.isEmpty else { return nil }
        return MessageDTO(
            id: id,
            roomId: p["room_id"] as? String ?? "",
            senderSessionId: (p["sender_session_id"] as? String) ?? sender,
            encryptedContent: content,
            messageType: p["message_type"] as? String ?? "text",
            deviceLabel: (p["device_label"] as? String) ?? device,
            recalledAt: nil,
            ttlSeconds: p["ttl_seconds"] as? Int,
            expiresAt: p["expires_at"] as? String,
            createdAt: (p["created_at"] as? String) ?? timestamp
        )
    }

    private func parseFile(_ p: [String: Any], sender: String, timestamp: String) -> FileMetaDTO? {
        let id = (p["id"] as? String) ?? (p["file_id"] as? String) ?? ""
        let name = p["encrypted_filename"] as? String ?? ""
        guard !id.isEmpty, !name.isEmpty else { return nil }
        return FileMetaDTO(
            id: id,
            roomId: p["room_id"] as? String ?? "",
            uploaderSessionId: (p["uploader_session_id"] as? String) ?? sender,
            encryptedFilename: name,
            encryptedMeta: p["encrypted_meta"] as? String,
            fileSize: p["file_size"] as? Int ?? 0,
            mimeType: p["mime_type"] as? String ?? "application/octet-stream",
            visibility: p["visibility"] as? String ?? "private",
            expiresAt: p["expires_at"] as? String ?? timestamp,
            recalledAt: nil,
            createdAt: (p["created_at"] as? String) ?? timestamp,
            fileHash: p["file_hash"] as? String
        )
    }
}
