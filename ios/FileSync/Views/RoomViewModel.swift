//
//  RoomViewModel.swift
//  FileSync
//
//  Drives a single room: loads & decrypts chat/files, streams live updates
//  over WebSocket, and handles send / upload / download / recall — all with
//  client-side E2E encryption.
//

import Foundation
import SwiftUI
import Combine
import UniformTypeIdentifiers

@MainActor
final class RoomViewModel: nonisolated ObservableObject {
    let room: KnownRoom
    private var app: AppState!

    @Published var messages: [MessageDTO] = []          // ascending by createdAt
    @Published var decrypted: [String: String] = [:]    // messageId -> plaintext
    @Published var files: [FileMetaDTO] = []            // newest first
    @Published var filenames: [String: String] = [:]    // fileId -> plaintext name
    @Published var isConnected = false
    @Published var isLoading = true
    @Published var onlineCount = 0
    @Published var uploads: [UploadTask] = []

    private var socket: RoomSocket?
    private var messageIds = Set<String>()
    private var fileIds = Set<String>()

    private var key: Data { room.key }
    private var roomId: String { room.serverId }
    private var api: APIClient { app.api }

    init(room: KnownRoom) {
        self.room = room
    }

    /// Inject the shared app controller (done from the view once the
    /// environment is available). Safe to call more than once.
    func bind(_ app: AppState) {
        if self.app == nil { self.app = app }
    }

    // MARK: - Lifecycle

    func start() async {
        await reload()
        connectSocket()
    }

    func stop() {
        socket?.close()
        socket = nil
    }

    func reload() async {
        isLoading = true
        await loadMessages()
        await loadFiles()
        isLoading = false
    }

    private func connectSocket() {
        guard socket == nil else { return }
        let sock = RoomSocket(api: api, roomCode: room.code,
                              sessionId: app.session?.token ?? "",
                              deviceLabel: app.deviceLabel)
        sock.onEvent = { [weak self] event in self?.handle(event) }
        socket = sock
        sock.connect()
        // Reflect connection state.
        Task { [weak self] in
            while let self, self.socket === sock {
                self.isConnected = sock.isConnected
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    // MARK: - Loading

    private func loadMessages() async {
        do {
            let res = try await api.getMessages(roomId: roomId)
            for msg in res.messages { insert(msg) }
        } catch let err as APIError {
            if err.isUnauthorized { app.handleUnauthorized() }
            else { app.show(.error, "加载消息失败：\(err.message)") }
        } catch { app.show(.error, error.localizedDescription) }
    }

    private func loadFiles() async {
        do {
            let res = try await api.listFiles(roomId: roomId)
            for file in res.files where file.recalledAt == nil { insertFile(file) }
        } catch let err as APIError {
            if err.isUnauthorized { app.handleUnauthorized() }
        } catch { /* non-fatal */ }
    }

    // MARK: - Insert + decrypt

    private func insert(_ msg: MessageDTO) {
        guard msg.messageType == "text", msg.recalledAt == nil else { return }
        guard !messageIds.contains(msg.id) else { return }
        messageIds.insert(msg.id)
        messages.append(msg)
        messages.sort { $0.createdAt < $1.createdAt }
        decryptMessage(msg)
    }

    private func decryptMessage(_ msg: MessageDTO) {
        guard decrypted[msg.id] == nil else { return }
        do {
            decrypted[msg.id] = try Crypto.decryptText(msg.encryptedContent, key: key)
        } catch {
            decrypted[msg.id] = "[无法解密]"
        }
    }

    private func insertFile(_ file: FileMetaDTO) {
        guard !fileIds.contains(file.id) else { return }
        fileIds.insert(file.id)
        files.insert(file, at: 0)
        files.sort { $0.createdAt > $1.createdAt }
        decryptFilename(file)
    }

    private func decryptFilename(_ file: FileMetaDTO) {
        guard filenames[file.id] == nil else { return }
        do {
            filenames[file.id] = try Crypto.decryptText(file.encryptedFilename, key: key)
        } catch {
            filenames[file.id] = "加密文件"
        }
    }

    func isMine(_ senderSessionId: String) -> Bool {
        senderSessionId == app.session?.token
    }

    // MARK: - Send message

    func send(text: String, ttlSeconds: Int?) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let encrypted = try Crypto.encryptText(trimmed, key: key)
            let res = try await api.sendMessage(roomId: roomId, encryptedContent: encrypted,
                                                deviceLabel: app.deviceLabel, ttlSeconds: ttlSeconds)
            let optimistic = MessageDTO(
                id: res.messageId, roomId: roomId,
                senderSessionId: app.session?.token ?? "",
                encryptedContent: encrypted, messageType: "text",
                deviceLabel: app.deviceLabel, recalledAt: nil,
                ttlSeconds: ttlSeconds, expiresAt: nil, createdAt: res.createdAt)
            insert(optimistic)
        } catch let err as APIError {
            if err.isUnauthorized { app.handleUnauthorized() }
            else { app.show(.error, "发送失败：\(err.message)") }
        } catch { app.show(.error, error.localizedDescription) }
    }

    func recallMessage(_ msg: MessageDTO) async {
        do {
            try await api.recallMessage(messageId: msg.id, roomId: roomId)
            removeMessage(id: msg.id)
        } catch let err as APIError {
            app.show(.error, "撤回失败：\(err.message)")
        } catch { app.show(.error, error.localizedDescription) }
    }

    private func removeMessage(id: String) {
        messages.removeAll { $0.id == id }
        messageIds.remove(id)
        decrypted[id] = nil
    }

    private func removeFile(id: String) {
        files.removeAll { $0.id == id }
        fileIds.remove(id)
        filenames[id] = nil
    }

    // MARK: - Upload

    func upload(urls: [URL]) {
        for url in urls { uploadOne(url) }
    }

    private func uploadOne(_ url: URL) {
        let taskId = UUID()
        let name = url.lastPathComponent
        let needsStop = url.startAccessingSecurityScopedResource()
        let fileData: Data
        do {
            fileData = try Data(contentsOf: url)
        } catch {
            if needsStop { url.stopAccessingSecurityScopedResource() }
            app.show(.error, "无法读取文件：\(name)")
            return
        }
        if needsStop { url.stopAccessingSecurityScopedResource() }

        uploads.append(UploadTask(id: taskId, name: name, progress: 0, status: .encrypting))
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"

        Task {
            do {
                let k = key
                // Encrypt off the main actor.
                let encrypted = try await Task.detached(priority: .userInitiated) {
                    try Crypto.encrypt(fileData, key: k)
                }.value
                let encryptedFilename = try Crypto.encryptText(name, key: k)
                let fileHash = await Task.detached { Crypto.fileHash(fileData) }.value

                updateUpload(taskId) { $0.status = .uploading }

                let chunkSize = fileData.count <= 100 * 1024 * 1024 ? 5 * 1024 * 1024 : 10 * 1024 * 1024
                let expiresAt = iso(from: Date().addingTimeInterval(10 * 60))
                let initRes = try await api.initUpload(filename: name, totalSize: encrypted.count,
                                                       chunkSize: chunkSize, roomId: roomId,
                                                       visibility: "private", expiresAt: expiresAt)

                let totalChunks = max(1, Int(ceil(Double(encrypted.count) / Double(chunkSize))))
                var parts: [UploadPartResponse] = []
                for i in 0..<totalChunks {
                    let startIdx = i * chunkSize
                    let endIdx = min(startIdx + chunkSize, encrypted.count)
                    let chunk = encrypted.subdata(in: startIdx..<endIdx)
                    let part = try await api.uploadPart(uploadId: initRes.uploadId, partNumber: i + 1, chunk: chunk)
                    parts.append(part)
                    let progress = Double(i + 1) / Double(totalChunks) * 0.95
                    updateUpload(taskId) { $0.progress = progress }
                }

                let complete = try await api.completeUpload(
                    uploadId: initRes.uploadId, r2Key: initRes.r2Key, parts: parts,
                    encryptedFilename: encryptedFilename, fileSize: encrypted.count,
                    mimeType: mime, visibility: "private", expiresAt: expiresAt,
                    roomId: roomId, fileHash: fileHash)

                let meta = FileMetaDTO(
                    id: complete.fileId, roomId: roomId,
                    uploaderSessionId: app.session?.token ?? "",
                    encryptedFilename: encryptedFilename, encryptedMeta: nil,
                    fileSize: encrypted.count, mimeType: mime, visibility: "private",
                    expiresAt: expiresAt, recalledAt: nil,
                    createdAt: iso(from: Date()), fileHash: fileHash)
                insertFile(meta)

                updateUpload(taskId) { $0.progress = 1; $0.status = .done }
                app.show(.success, "\(name) 已上传")
                Task {
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    self.uploads.removeAll { $0.id == taskId }
                }
            } catch let err as APIError {
                updateUpload(taskId) { $0.status = .failed }
                app.show(.error, "\(name)：\(err.message)")
            } catch {
                updateUpload(taskId) { $0.status = .failed }
                app.show(.error, "\(name)：\(error.localizedDescription)")
            }
        }
    }

    private func updateUpload(_ id: UUID, _ mutate: (inout UploadTask) -> Void) {
        guard let idx = uploads.firstIndex(where: { $0.id == id }) else { return }
        mutate(&uploads[idx])
    }

    // MARK: - Download

    /// Download + decrypt a file, writing it to a temp URL for sharing/preview.
    func download(_ file: FileMetaDTO) async -> URL? {
        do {
            let (data, encrypted) = try await api.downloadFile(fileId: file.id)
            let k = key
            let plain: Data
            if encrypted {
                plain = try await Task.detached(priority: .userInitiated) {
                    try Crypto.decrypt(data, key: k)
                }.value
                if let expected = file.fileHash {
                    let actual = await Task.detached { Crypto.fileHash(plain) }.value
                    if actual != expected { app.show(.error, "文件校验失败，可能已被篡改") }
                }
            } else {
                plain = data
            }
            let name = filenames[file.id] ?? "file"
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(name)
            try plain.write(to: dest)
            return dest
        } catch let err as APIError {
            if err.isUnauthorized { app.handleUnauthorized() }
            else { app.show(.error, "下载失败：\(err.message)") }
            return nil
        } catch {
            app.show(.error, error.localizedDescription)
            return nil
        }
    }

    func recallFile(_ file: FileMetaDTO) async {
        do {
            try await api.recallFile(fileId: file.id)
            removeFile(id: file.id)
        } catch let err as APIError {
            app.show(.error, "删除失败：\(err.message)")
        } catch { app.show(.error, error.localizedDescription) }
    }

    // MARK: - WS events

    private func handle(_ event: RoomEvent) {
        switch event {
        case .chatMessage(let msg): insert(msg)
        case .fileShared(let file): insertFile(file)
        case .recall(let mid, let fid):
            if let mid { removeMessage(id: mid) }
            if let fid { removeFile(id: fid) }
        case .presence(let count): onlineCount = count
        case .removed(let id): removeMessage(id: id); removeFile(id: id)
        case .system(let action, _):
            if action == "room_destroyed" {
                app.show(.info, "房间已被销毁")
                app.forgetRoom(room)
            }
        }
    }

    private func iso(from date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }
}

struct UploadTask: Identifiable, Equatable {
    enum Status { case encrypting, uploading, done, failed }
    let id: UUID
    var name: String
    var progress: Double
    var status: Status
}
