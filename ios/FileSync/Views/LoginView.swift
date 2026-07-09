//
//  LoginView.swift
//  FileSync
//
//  Server configuration + authentication (admin / API key / temp credential).
//

import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var app: AppState

    @State private var serverURL = ""
    @State private var method: LoginMethod = .admin
    @State private var username = "admin"
    @State private var password = ""
    @State private var apiKey = ""
    @State private var tempCode = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://filesync-api.example.workers.dev", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.callout)
                } header: {
                    Text("服务器地址")
                } footer: {
                    Text("你的 Cloudflare Worker 地址，不含 /api 后缀。")
                }

                Section("登录方式") {
                    Picker("方式", selection: $method) {
                        ForEach(LoginMethod.allCases) { m in
                            Text(m.label).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)

                    switch method {
                    case .admin:
                        TextField("用户名", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("密码", text: $password)
                    case .apiKey:
                        SecureField("API 密钥", text: $apiKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    case .tempCredential:
                        TextField("6 位临时口令", text: $tempCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Spacer()
                            if isSubmitting { ProgressView().tint(.white) }
                            else { Text("登录").fontWeight(.semibold) }
                            Spacer()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .disabled(isSubmitting || !canSubmit)
                }
            }
            .navigationTitle("FileSync")
            .onAppear { serverURL = app.serverURL }
        }
    }

    private var canSubmit: Bool {
        guard !serverURL.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        switch method {
        case .admin: return !username.isEmpty && !password.isEmpty
        case .apiKey: return !apiKey.isEmpty
        case .tempCredential: return !tempCode.isEmpty
        }
    }

    private func submit() {
        app.setServerURL(serverURL)
        let credentials: [String: String]
        switch method {
        case .admin: credentials = ["username": username, "password": password]
        case .apiKey: credentials = ["api_key": apiKey]
        case .tempCredential: credentials = ["temp_code": tempCode.uppercased()]
        }
        isSubmitting = true
        Task {
            await app.login(method: method, credentials: credentials)
            isSubmitting = false
        }
    }
}

#Preview {
    LoginView().environmentObject(AppState())
}
