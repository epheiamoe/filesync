//
//  AppState.swift
//  FileSync
//
//  Central observable app controller: server config, auth session,
//  known rooms, and the shared API client.
//

import Foundation
import SwiftUI
import UIKit
import Combine

@MainActor
final class AppState: nonisolated ObservableObject {
    @Published var serverURL: String
    @Published var session: StoredSession?
    @Published var rooms: [KnownRoom]
    @Published var banner: BannerMessage?

    let api = APIClient()
    let fingerprint = KeyStore.clientFingerprint()

    /// Human-readable device label sent to the server, e.g. "iPhone FileSync".
    let deviceLabel: String = "\(UIDevice.current.model) FileSync"

    var isLoggedIn: Bool { session != nil }

    /// Default server used when the user hasn't configured one yet.
    static let defaultServerURL = "https://filesync-api.epheia.moe"

    init() {
        let saved = KeyStore.serverURL()
        serverURL = saved.isEmpty ? Self.defaultServerURL : saved
        session = KeyStore.session()
        rooms = KeyStore.knownRooms()
        api.serverURL = serverURL
        api.token = session?.token
    }

    // MARK: - Config

    func setServerURL(_ url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        serverURL = trimmed
        api.serverURL = trimmed
        KeyStore.setServerURL(trimmed)
    }

    // MARK: - Auth

    func login(method: LoginMethod, credentials: [String: String]) async {
        guard !serverURL.isEmpty else {
            show(.error, "请先填写服务器地址")
            return
        }
        do {
            let res = try await api.login(method: method, credentials: credentials)
            let stored = StoredSession(token: res.token, accountType: res.accountType, scope: res.scope)
            session = stored
            api.token = res.token
            KeyStore.setSession(stored)
        } catch let err as APIError {
            show(.error, err.message)
        } catch {
            show(.error, error.localizedDescription)
        }
    }

    func logout() async {
        await api.logout()
        session = nil
        api.token = nil
        KeyStore.setSession(nil)
    }

    /// Called when any request returns 401 — drop the session so the UI re-gates.
    func handleUnauthorized() {
        session = nil
        api.token = nil
        KeyStore.setSession(nil)
        show(.error, "登录已过期，请重新登录")
    }

    // MARK: - Rooms

    /// Create a new room: generate a key locally, send only its hash.
    func createRoom(customCode: String?) async -> KnownRoom? {
        let key = Crypto.generateRoomKey()
        let keyHash = Crypto.hashKey(key)
        do {
            let code = (customCode?.isEmpty == false) ? customCode : nil
            let res = try await api.createRoom(keyHash: keyHash, roomCode: code)
            let room = KnownRoom(code: res.roomCode, serverId: res.id, keyHex: key.hexString)
            KeyStore.upsertRoom(room)
            rooms = KeyStore.knownRooms()
            // Register membership so the room is discoverable server-side too.
            _ = try? await api.joinRoom(roomCode: room.code, keyHash: keyHash,
                                        deviceLabel: deviceLabel, fingerprint: fingerprint)
            return room
        } catch let err as APIError {
            handle(err)
            return nil
        } catch {
            show(.error, error.localizedDescription)
            return nil
        }
    }

    /// Join a room from a share string ("{code}-{key}").
    func joinRoom(shareString: String) async -> KnownRoom? {
        guard let decoded = Crypto.decodeShareString(shareString) else {
            show(.error, "无效的分享码")
            return nil
        }
        let keyHash = Crypto.hashKey(decoded.key)
        do {
            let res = try await api.joinRoom(roomCode: decoded.roomCode, keyHash: keyHash,
                                             deviceLabel: deviceLabel, fingerprint: fingerprint)
            var serverId = res.roomId ?? ""
            if serverId.isEmpty {
                serverId = (try? await api.getRoomInfo(code: decoded.roomCode))?.id ?? ""
            }
            let room = KnownRoom(code: decoded.roomCode, serverId: serverId, keyHex: decoded.key.hexString)
            KeyStore.upsertRoom(room)
            rooms = KeyStore.knownRooms()
            return room
        } catch let err as APIError {
            handle(err)
            return nil
        } catch {
            show(.error, error.localizedDescription)
            return nil
        }
    }

    /// Refresh member counts from the server for known rooms (best-effort).
    func refreshRooms() async {
        var updated = KeyStore.knownRooms()
        for i in updated.indices {
            if let info = try? await api.getRoomInfo(code: updated[i].code), info.id.isEmpty == false {
                updated[i].serverId = info.id
            }
        }
        KeyStore.saveKnownRooms(updated)
        rooms = updated
    }

    func forgetRoom(_ room: KnownRoom) {
        KeyStore.removeRoom(code: room.code)
        rooms = KeyStore.knownRooms()
    }

    // MARK: - Errors & banners

    private func handle(_ err: APIError) {
        if err.isUnauthorized { handleUnauthorized() }
        else { show(.error, err.message) }
    }

    func show(_ kind: BannerMessage.Kind, _ text: String) {
        banner = BannerMessage(kind: kind, text: text)
    }
}

struct BannerMessage: Identifiable, Equatable {
    enum Kind { case success, error, info }
    let id = UUID()
    let kind: Kind
    let text: String
}
