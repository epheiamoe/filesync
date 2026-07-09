//
//  JoinRoomView.swift
//  FileSync
//
//  Join a room by pasting its share string ("{code}-{key}"). The key is
//  decoded locally; only its hash is sent to the server.
//

import SwiftUI
import UIKit

struct JoinRoomView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var shareString = ""
    @State private var isJoining = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("4821-XK7M-A3PQ-…", text: $shareString, axis: .vertical)
                        .font(.system(.callout, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .lineLimit(2...4)
                } header: {
                    Text("分享码")
                } footer: {
                    Text("粘贴对方给你的完整分享码（包含房间码与密钥）。")
                }

                Section {
                    Button {
                        shareString = UIPasteboard.general.string ?? shareString
                    } label: {
                        Label("从剪贴板粘贴", systemImage: "doc.on.clipboard")
                    }
                }

                Section {
                    Button(action: join) {
                        HStack {
                            Spacer()
                            if isJoining { ProgressView() }
                            else { Text("加入房间").fontWeight(.semibold) }
                            Spacer()
                        }
                    }
                    .disabled(isJoining || shareString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .navigationTitle("加入房间")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(isJoining)
    }

    private func join() {
        isJoining = true
        Task {
            let room = await app.joinRoom(shareString: shareString)
            isJoining = false
            if room != nil {
                app.show(.success, "已加入房间")
                dismiss()
            }
        }
    }
}
