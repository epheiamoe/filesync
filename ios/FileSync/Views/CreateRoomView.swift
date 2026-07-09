//
//  CreateRoomView.swift
//  FileSync
//
//  Create a new E2E-encrypted room. The 32-byte key is generated on-device;
//  only its SHA-256 hash is sent to the server. The share string carries the
//  key and must be delivered out-of-band to peers.
//

import SwiftUI
import UIKit

struct CreateRoomView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var customCode = ""
    @State private var isCreating = false
    @State private var createdRoom: KnownRoom?
    @State private var showShare = false

    var body: some View {
        NavigationStack {
            Form {
                if let room = createdRoom {
                    createdSection(room)
                } else {
                    formSection
                }
            }
            .navigationTitle("创建房间")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .disabled(createdRoom == nil && isCreating)
                }
            }
            .sheet(isPresented: $showShare) {
                if let room = createdRoom { ShareSheet(items: [room.shareString]) }
            }
        }
        .interactiveDismissDisabled(isCreating)
    }

    private var formSection: some View {
        Group {
            Section {
                TextField("自定义房间码（可选，4 位数字）", text: $customCode)
                    .keyboardType(.numberPad)
                    .onChange(of: customCode) { _, new in
                        customCode = String(new.filter(\.isNumber).prefix(4))
                    }
            } footer: {
                Text("留空则由服务器随机分配一个房间码。")
            }

            Section {
                Button(action: create) {
                    HStack {
                        Spacer()
                        if isCreating { ProgressView() }
                        else { Text("生成密钥并创建").fontWeight(.semibold) }
                        Spacer()
                    }
                }
                .disabled(isCreating || (!customCode.isEmpty && customCode.count != 4))
            }
        }
    }

    private func createdSection(_ room: KnownRoom) -> some View {
        Group {
            Section {
                VStack(spacing: 6) {
                    Text("房间已创建")
                        .font(.headline)
                    Text(room.code)
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.accentColor)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            Section {
                Text(room.shareString)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
            } header: {
                Text("分享码（含密钥）")
            } footer: {
                Text("⚠️ 该分享码包含解密密钥，请通过安全渠道发送给对方。服务器无法看到密钥。")
            }

            Section {
                Button {
                    UIPasteboard.general.string = room.shareString
                    app.show(.success, "已复制分享码")
                } label: {
                    Label("复制分享码", systemImage: "doc.on.doc")
                }
                Button {
                    showShare = true
                } label: {
                    Label("分享…", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    private func create() {
        isCreating = true
        Task {
            let room = await app.createRoom(customCode: customCode.isEmpty ? nil : customCode)
            isCreating = false
            if let room {
                createdRoom = room
                app.show(.success, "房间创建成功")
            }
        }
    }
}
