//
//  SettingsView.swift
//  FileSync
//
//  Account / server info and logout.
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var stats: AdminStats?

    var body: some View {
        NavigationStack {
            Form {
                Section("服务器") {
                    LabeledContent("地址", value: app.serverURL)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let session = app.session {
                        LabeledContent("账户类型", value: accountLabel(session.accountType))
                    }
                }

                if let session = app.session, session.accountType == "admin" {
                    Section("存储统计") {
                        if let stats {
                            LabeledContent("房间数", value: "\(stats.roomCount)")
                            LabeledContent("文件数", value: "\(stats.r2FileCount)")
                            LabeledContent("占用空间", value: Format.fileSize(stats.r2TotalBytes))
                            LabeledContent("活跃会话", value: "\(stats.activeSessions)")
                        } else {
                            HStack { Text("加载中…"); Spacer(); ProgressView() }
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task {
                            await app.logout()
                            dismiss()
                        }
                    } label: {
                        Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                Section {
                    LabeledContent("设备标识", value: app.deviceLabel)
                    LabeledContent("客户端指纹", value: String(app.fingerprint.prefix(8)) + "…")
                } footer: {
                    Text("FileSync iOS 客户端 · 端到端加密。房间密钥仅保存在本机。")
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .task {
                if app.session?.accountType == "admin" {
                    stats = try? await app.api.adminStats()
                }
            }
        }
    }

    private func accountLabel(_ type: String) -> String {
        switch type {
        case "admin": return "管理员"
        case "api_key": return "API 密钥"
        case "temp_credential": return "临时口令"
        default: return type
        }
    }
}
