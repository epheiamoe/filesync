//
//  RoomView.swift
//  FileSync
//
//  Room container: Chat / Files tabs, live connection indicator, share.
//

import SwiftUI
import UIKit

struct RoomView: View {
    let room: KnownRoom
    @EnvironmentObject private var app: AppState
    @StateObject private var vm: RoomViewModel
    @State private var tab: Tab = .chat
    @State private var showShare = false

    enum Tab: String, CaseIterable { case chat = "聊天", files = "文件" }

    init(room: KnownRoom) {
        self.room = room
        _vm = StateObject(wrappedValue: RoomViewModel(room: room))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            Divider()

            switch tab {
            case .chat: ChatView(vm: vm)
            case .files: FilesView(vm: vm)
            }
        }
        .navigationTitle("房间 \(room.code)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text("房间 \(room.code)").font(.headline)
                    HStack(spacing: 4) {
                        Circle()
                            .fill(vm.isConnected ? Color.green : Color.secondary)
                            .frame(width: 6, height: 6)
                        Text(vm.isConnected ? "实时已连接" : "连接中…")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        UIPasteboard.general.string = room.shareString
                        app.show(.success, "已复制分享码")
                    } label: { Label("复制分享码", systemImage: "doc.on.doc") }
                    Button { showShare = true } label: {
                        Label("分享房间", systemImage: "square.and.arrow.up")
                    }
                    Divider()
                    Button(role: .destructive) {
                        app.forgetRoom(room)
                    } label: { Label("从本机移除", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showShare) { ShareSheet(items: [room.shareString]) }
        .task {
            vm.bind(app)
            await vm.start()
        }
        .onDisappear { vm.stop() }
    }
}
