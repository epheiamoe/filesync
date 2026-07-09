//
//  Utilities.swift
//  FileSync
//
//  Shared formatting helpers and UIKit bridges (share sheet, document picker).
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Formatters

enum Format {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func date(_ iso8601: String?) -> Date? {
        guard let iso8601 else { return nil }
        return iso.date(from: iso8601) ?? isoNoFraction.date(from: iso8601)
    }

    static func time(_ iso8601: String) -> String {
        guard let d = date(iso8601) else { return "" }
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "MM-dd HH:mm"
        return f.string(from: d)
    }

    static func fileSize(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    /// Remaining time until an ISO expiry, e.g. "剩 4:32" or nil if expired/far.
    static func countdown(to iso8601: String) -> String? {
        guard let d = date(iso8601) else { return nil }
        let remaining = Int(d.timeIntervalSinceNow)
        guard remaining > 0 else { return "已过期" }
        if remaining >= 3600 { return nil }
        return String(format: "剩 %d:%02d", remaining / 60, remaining % 60)
    }
}

// MARK: - Share sheet

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Document picker (import files)

struct DocumentPicker: UIViewControllerRepresentable {
    var onPick: ([URL]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: ([URL]) -> Void
        init(onPick: @escaping ([URL]) -> Void) { self.onPick = onPick }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onPick(urls)
        }
    }
}

// MARK: - MIME icon

enum FileIcon {
    static func systemName(for mime: String) -> String {
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "waveform" }
        if mime.hasPrefix("text/") { return "doc.text" }
        if mime == "application/pdf" { return "doc.richtext" }
        if mime.contains("zip") || mime.contains("compressed") || mime.contains("tar") { return "doc.zipper" }
        return "doc"
    }
}
