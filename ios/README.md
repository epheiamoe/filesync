# FileSync — iOS 客户端

FileSync 的原生 SwiftUI iOS 客户端。端到端加密，与网页端**完全互通**：iOS 上创建的房间可以在网页端打开，消息与文件互相解密。

## 特性

- **端到端加密**：房间密钥（32 字节）在本机生成，只向服务器发送其 SHA-256 哈希（`key_hash`），密钥永不离开设备。
- **三种登录方式**：管理员账号 / API 密钥 / 临时口令。
- **房间**：创建（生成分享码）、通过分享码加入、本地保存已加入的房间。
- **加密聊天**：实时收发（WebSocket + 断线重连）、阅后即焚 TTL（10 秒 ～ 24 小时）、撤回、复制。
- **加密文件传输**：分块上传、下载后自动解密、SHA-256 完整性校验、撤回、系统分享。
- **管理**：管理员可查看存储统计。

## 技术架构

纯 SwiftUI + async/await，无第三方依赖（加密用系统 CryptoKit）。

```
FileSync/
├── Core/
│   ├── Crypto.swift        # AES-256-GCM + Crockford Base32 + SHA-256（与 web crypto.ts 逐字节一致）
│   ├── Models.swift        # API DTO（Codable）
│   ├── APIClient.swift     # REST 封装（auth / rooms / chat / files / admin）
│   ├── KeyStore.swift      # 房间密钥、已知房间、客户端指纹、会话的本地持久化
│   ├── AppState.swift      # 全局状态（ObservableObject）
│   └── RoomSocket.swift    # WebSocket 实时连接（ticket 握手 + 自动重连 + 心跳）
├── Views/                  # 登录 / 房间列表 / 创建 / 加入 / 房间（聊天 + 文件）/ 设置
├── ContentView.swift       # 根视图 + 全局提示条
└── FileSyncApp.swift       # App 入口
```

## 加密互通性

客户端加密方案是网页端 `packages/frontend/src/lib/crypto.ts` 的逐字节移植：

| 项 | 方案 |
|---|---|
| 房间密钥 | 32 字节随机 |
| `key_hash` | `SHA-256(key)` 十六进制（服务器仅用于校验） |
| 分享码 | `{4 位房间码}-{密钥的 Crockford Base32，每 4 字符一组}` |
| 内容加密 | AES-256-GCM，线格式 `iv(12) ‖ 密文 ‖ tag(16)`；文本再 Base64 |

已用 Node WebCrypto（浏览器同款引擎）交叉验证：分享码逐字符一致、双向解密通过、`key_hash` 与 openssl 一致。

## 构建运行

- Xcode 26.5+ / iOS 26.5+
- 打开 `ios/FileSync.xcodeproj`，选择模拟器或真机运行。
- 首次启动在「服务器地址」填入你的 Cloudflare Worker 地址（不含 `/api` 后缀），选择登录方式登录即可。

> 说明：房间密钥当前保存在 `UserDefaults`（与网页端保存在 localStorage 一致）。如需更高安全性，可改用 Keychain。
