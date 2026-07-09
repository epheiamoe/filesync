//
//  FilesView.swift
//  FileSync
//
//  Encrypted file transfer: upload (document picker), list, download+decrypt.
//

import SwiftUI

struct FilesView: View {
    @ObservedObject var vm: RoomViewModel
    @State private var showPicker = false
    @State private var shareItem: ShareItem?
    @State private var downloadingId: String?

    var body: some View {
        VStack(spacing: 0) {
            uploadBar
            if !vm.uploads.isEmpty { uploadProgress }
            Divider()
            fileList
        }
        .sheet(isPresented: $showPicker) {
            DocumentPicker { urls in vm.upload(urls: urls) }
                .ignoresSafeArea()
        }
        .sheet(item: $shareItem) { item in
            ShareSheet(items: [item.url])
        }
    }

    private var uploadBar: some View {
        Button {
            showPicker = true
        } label: {
            HStack {
                Image(systemName: "arrow.up.doc.fill")
                Text("上传加密文件")
                    .fontWeight(.medium)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
        .buttonStyle(.borderedProminent)
        .padding(12)
    }

    private var uploadProgress: some View {
        VStack(spacing: 6) {
            ForEach(vm.uploads) { task in
                HStack(spacing: 10) {
                    Group {
                        switch task.status {
                        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                        default: ProgressView()
                        }
                    }
                    .frame(width: 22)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(task.name).font(.caption).lineLimit(1)
                        if task.status == .uploading || task.status == .encrypting {
                            ProgressView(value: task.progress)
                        }
                    }
                    Spacer()
                    Text(statusText(task)).font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14)
            }
        }
        .padding(.vertical, 8)
    }

    private var fileList: some View {
        Group {
            if vm.files.isEmpty && !vm.isLoading {
                ContentUnavailableView("暂无文件", systemImage: "tray",
                                       description: Text("上传的文件会端到端加密，默认 10 分钟后过期。"))
            } else {
                List {
                    ForEach(vm.files) { file in
                        FileRow(
                            name: vm.filenames[file.id] ?? "解密中…",
                            file: file,
                            isMine: vm.isMine(file.uploaderSessionId),
                            isDownloading: downloadingId == file.id,
                            onDownload: { download(file) },
                            onRecall: { Task { await vm.recallFile(file) } }
                        )
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private func download(_ file: FileMetaDTO) {
        downloadingId = file.id
        Task {
            let url = await vm.download(file)
            downloadingId = nil
            if let url { shareItem = ShareItem(url: url) }
        }
    }

    private func statusText(_ task: UploadTask) -> String {
        switch task.status {
        case .encrypting: return "加密中"
        case .uploading: return "\(Int(task.progress * 100))%"
        case .done: return "完成"
        case .failed: return "失败"
        }
    }
}

struct FileRow: View {
    let name: String
    let file: FileMetaDTO
    let isMine: Bool
    let isDownloading: Bool
    let onDownload: () -> Void
    let onRecall: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: FileIcon.systemName(for: file.mimeType))
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.subheadline).lineLimit(1)
                HStack(spacing: 6) {
                    Text(Format.fileSize(file.fileSize))
                    if let countdown = Format.countdown(to: file.expiresAt) {
                        Text("· \(countdown)").foregroundStyle(.orange)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if isDownloading {
                ProgressView()
            } else {
                Button(action: onDownload) {
                    Image(systemName: "arrow.down.circle")
                        .font(.title2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            if isMine {
                Button(role: .destructive, action: onRecall) {
                    Label("删除", systemImage: "trash")
                }
            }
        }
    }
}

/// Wrapper so a downloaded file URL can drive `.sheet(item:)`.
struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}
