//
//  FileSyncApp.swift
//  FileSync
//
//  Created by Sy Yann on 2026/7/9.
//

import SwiftUI

@main
struct FileSyncApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
        }
    }
}
