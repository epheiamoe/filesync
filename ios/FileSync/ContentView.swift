//
//  ContentView.swift
//  FileSync
//
//  Root view: gates on auth session, and hosts the global banner overlay.
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                if app.isLoggedIn {
                    RoomListView()
                } else {
                    LoginView()
                }
            }
            .animation(.easeInOut, value: app.isLoggedIn)

            BannerOverlay()
        }
    }
}

/// Transient toast-style banner driven by `AppState.banner`.
struct BannerOverlay: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        VStack {
            if let banner = app.banner {
                HStack(spacing: 10) {
                    Image(systemName: icon(banner.kind))
                    Text(banner.text)
                        .font(.subheadline.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(color(banner.kind), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: banner.id) {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if app.banner?.id == banner.id { app.banner = nil }
                }
                .onTapGesture { app.banner = nil }
            }
            Spacer()
        }
        .padding(.top, 8)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: app.banner)
    }

    private func icon(_ kind: BannerMessage.Kind) -> String {
        switch kind {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        }
    }

    private func color(_ kind: BannerMessage.Kind) -> Color {
        switch kind {
        case .success: return .green
        case .error: return .red
        case .info: return .accentColor
        }
    }
}

#Preview {
    RootView().environmentObject(AppState())
}
