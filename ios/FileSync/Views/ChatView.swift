//
//  ChatView.swift
//  FileSync
//
//  Encrypted chat: message bubbles + composer with optional self-destruct TTL.
//

import SwiftUI
import UIKit

struct ChatView: View {
    @ObservedObject var vm: RoomViewModel
    @State private var draft = ""
    @State private var ttl: TTLOption = .permanent
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            messageScroll
            Divider()
            composer
        }
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if vm.messages.isEmpty && !vm.isLoading {
                        Text("还没有消息，发送第一条加密消息吧。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 60)
                    }
                    ForEach(vm.messages) { msg in
                        MessageBubble(
                            text: vm.decrypted[msg.id],
                            isMine: vm.isMine(msg.senderSessionId),
                            deviceLabel: msg.deviceLabel,
                            time: Format.time(msg.createdAt),
                            ttlSeconds: msg.ttlSeconds,
                            onRecall: vm.isMine(msg.senderSessionId) ? { Task { await vm.recallMessage(msg) } } : nil,
                            onCopy: { copy(vm.decrypted[msg.id]) }
                        )
                        .id(msg.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: vm.messages.count) { _, _ in
                if let last = vm.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .onChange(of: inputFocused) { _, focused in
                if focused, let last = vm.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Menu {
                    Picker("阅后即焚", selection: $ttl) {
                        ForEach(TTLOption.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Image(systemName: ttl == .permanent ? "clock" : "timer")
                        .font(.system(size: 20))
                        .foregroundStyle(ttl == .permanent ? Color.secondary : Color.accentColor)
                }

                TextField("加密消息…", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($inputFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground), in: Capsule())

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(canSend ? Color.accentColor : Color.secondary)
                }
                .disabled(!canSend)
            }
            if ttl != .permanent {
                Text("消息将在发送后 \(ttl.label) 自动销毁")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        let text = draft
        draft = ""
        Task { await vm.send(text: text, ttlSeconds: ttl.seconds) }
    }

    private func copy(_ text: String?) {
        guard let text else { return }
        UIPasteboard.general.string = text
    }
}

// MARK: - Bubble

struct MessageBubble: View {
    let text: String?
    let isMine: Bool
    let deviceLabel: String?
    let time: String
    let ttlSeconds: Int?
    let onRecall: (() -> Void)?
    let onCopy: () -> Void

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 40) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if !isMine, let label = deviceLabel, !label.isEmpty {
                    Text(label).font(.caption2).foregroundStyle(.secondary)
                }
                Text(text ?? "解密中…")
                    .foregroundStyle(isMine ? .white : .primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        isMine ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color(.secondarySystemBackground)),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                    .textSelection(.enabled)
                HStack(spacing: 5) {
                    if ttlSeconds != nil {
                        Image(systemName: "timer").font(.system(size: 9))
                    }
                    Text(time).font(.caption2)
                }
                .foregroundStyle(.secondary)
            }
            if !isMine { Spacer(minLength: 40) }
        }
        .contextMenu {
            Button { onCopy() } label: { Label("复制", systemImage: "doc.on.doc") }
            if let onRecall {
                Button(role: .destructive) { onRecall() } label: {
                    Label("撤回", systemImage: "arrow.uturn.backward")
                }
            }
        }
    }
}

// MARK: - TTL options

enum TTLOption: String, CaseIterable, Identifiable {
    case permanent, s10, m1, m5, h1, h24
    var id: String { rawValue }
    var seconds: Int? {
        switch self {
        case .permanent: return nil
        case .s10: return 10
        case .m1: return 60
        case .m5: return 300
        case .h1: return 3600
        case .h24: return 86400
        }
    }
    var label: String {
        switch self {
        case .permanent: return "永久"
        case .s10: return "10 秒"
        case .m1: return "1 分钟"
        case .m5: return "5 分钟"
        case .h1: return "1 小时"
        case .h24: return "24 小时"
        }
    }
}
