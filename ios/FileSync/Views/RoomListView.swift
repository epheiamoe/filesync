//
//  RoomListView.swift
//  FileSync
//
//  Lists rooms this device holds keys for. Entry point after login.
//

import SwiftUI

struct RoomListView: View {
    @EnvironmentObject private var app: AppState
    @State private var showCreate = false
    @State private var showJoin = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if app.rooms.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(app.rooms) { room in
                            NavigationLink(value: room) {
                                RoomRow(room: room)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("我的房间")
            .navigationDestination(for: KnownRoom.self) { room in
                RoomView(room: room)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showCreate = true } label: {
                            Label("创建房间", systemImage: "plus.circle")
                        }
                        Button { showJoin = true } label: {
                            Label("加入房间", systemImage: "arrow.right.circle")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showCreate) { CreateRoomView() }
            .sheet(isPresented: $showJoin) { JoinRoomView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .refreshable { await app.refreshRooms() }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("暂无房间", systemImage: "lock.rectangle.stack")
        } description: {
            Text("创建一个端到端加密的房间，或用分享码加入现有房间。")
        } actions: {
            HStack {
                Button("创建房间") { showCreate = true }
                    .buttonStyle(.borderedProminent)
                Button("加入房间") { showJoin = true }
                    .buttonStyle(.bordered)
            }
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            app.forgetRoom(app.rooms[index])
        }
    }
}

struct RoomRow: View {
    let room: KnownRoom

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.accentColor.opacity(0.15))
                    .frame(width: 46, height: 46)
                Image(systemName: "number")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("房间 \(room.code)")
                    .font(.headline)
                Text("端到端加密 · 已保存密钥")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "lock.fill")
                .font(.caption)
                .foregroundStyle(.green)
        }
        .padding(.vertical, 4)
    }
}
