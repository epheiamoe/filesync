# filesync API 文档

> Base URL: `<YOUR_WORKER_URL>`（示例: `https://filesync-api.<subdomain>.workers.dev`）

## 认证

认证方式按优先级：
1. **Cookie**：`epheia_session` HttpOnly cookie（浏览器自动携带）
2. **Header**：`Authorization: Bearer <token>`（API / CLI 兼容）

所有需要认证的端点需携带上述任一凭证。

### POST /api/auth/login
登录，支持三种方式。

**Body:**
```json
{ "method": "admin", "username": "admin", "password": "..." }
{ "method": "api_key", "api_key": "..." }
{ "method": "temp_credential", "temp_code": "ABC123" }
```

**Response:**
```json
{ "success": true, "data": { "token": "...", "scope": "admin create_rooms join_room", "account_type": "admin", "expires_at": "2026-06-27T..." } }
```

### GET /api/auth/session
验证当前 session 是否有效。

**Response:** `{ "success": true, "data": { "valid": true, "account_type": "admin", "scope": "..." } }`

### POST /api/auth/logout
登出。

---

## 房间

### POST /api/rooms
创建房间。

**Body:** `{ "key_hash": "<SHA-256 hex>", "room_code?": "1234" }`

**Response:** `{ "success": true, "data": { "id": "...", "room_code": "1234", "created_at": "..." } }`

### GET /api/rooms
列出房间。

**Response:** `{ "success": true, "data": { "rooms": [{ "id": "...", "room_code": "1234", "member_count": 1, "created_at": "..." }] } }`

### POST /api/rooms/join
加入房间。

**Body:** `{ "room_code": "1234", "key_hash": "<SHA-256 hex>", "device_label?": "Windows Chrome" }`

### GET /api/rooms/:code
获取房间信息。

---

## 聊天

### POST /api/chat/messages
发送消息。

**Body:** `{ "room_id": "...", "encrypted_content": "<base64>", "message_type": "text|file_shared|system", "device_label?": "..." }`

**Response:** `{ "success": true, "data": { "message_id": "...", "created_at": "..." } }`

### GET /api/chat/messages?room_id=...&before=...&limit=50
获取消息（分页）。

### DELETE /api/chat/messages/:id
撤回消息（需发送者本人或管理员）。

**Body:** `{ "room_id": "..." }`

---

## 文件

### POST /api/files/upload/init
初始化分块上传。

**Body:** `{ "filename": "...", "total_size": 1024, "chunk_size": 5242880, "room_id": "...", "visibility": "private|public", "expires_at?": "ISO8601" }`

**Response:** `{ "success": true, "data": { "upload_id": "...", "r2_key": "...", "chunks_needed": 1 } }`

### POST /api/files/upload/part
上传分块（multipart/form-data）。

**Fields:** `upload_id`, `part_number` (1-indexed), `chunk` (binary)

### POST /api/files/upload/complete
完成上传。

**Body:** `{ "upload_id": "...", "r2_key": "...", "parts": [{"etag":"...", "part_number":1}], "encrypted_filename": "...", "file_size": 1024, "mime_type": "text/plain", "visibility": "private", "expires_at": "...", "room_id": "..." }`

### POST /api/files/upload/abort
取消上传。`{ "upload_id": "..." }`

### GET /api/files/:id/download
下载文件（私密文件需认证）。

### GET /api/files/:id/info
获取文件元数据。

### GET /api/files/room/:roomId
列出房间文件。

### DELETE /api/files/:id
撤回/删除文件。

---

## WebSocket

### GET /api/ws?room=XXXX&token=YYY
获取 WebSocket 连接 ticket（60s 有效）。

**Response:** `{ "success": true, "data": { "ticket": "..." } }`

### GET /api/ws/connect?ticket=XXX
使用 ticket 建立 WebSocket 连接（Upgrade 到 RoomDO）。

WebSocket 消息格式（`WsMessage` / `BroadcastEvent`）：
```json
{
  "type": "chat | file_shared | recall | member_join | member_leave | system",
  "payload": <事件载体>,
  "sender_session_id": "...",
  "device_label": "...",
  "timestamp": "ISO 8601"
}
```
> **注意：** 前端接收事件的 key 是 `payload`，不是 `data`。该字段名已在 `8bbc8c6` 提交中与后端对齐。

---

## 管理面板（Admin Only）

### GET /api/admin/stats
**Response:** `{ "success": true, "data": { "r2_total_bytes": 89, "r2_file_count": 2, "room_count": 3, "active_sessions": 5 } }`

### GET /api/admin/rooms
列出所有房间及用量。

### DELETE /api/admin/rooms/:code
销毁房间（级联删除所有消息、文件、成员）。

### POST /api/auth/credentials
创建临时凭证。返回 6 位字母数字码。

### GET /api/auth/credentials
列出凭证。

### DELETE /api/auth/credentials/:id
撤销凭证。

### POST /api/auth/api-keys
创建 API 密钥（admin only）。现在必须提供一个 `label` 用于描述该密钥用途。

**Body:** `{ "label": "CI deploy" }`（1–100 字符）

**Response:**
```json
{
  "success": true,
  "data": {
    "key": "32-char-hex",
    "label": "CI deploy",
    "created_at": "2026-07-13T00:00:00Z"
  }
}
```
> **注意：** 完整 `key` 仅在创建响应中返回一次，后续列表接口只返回前缀与哈希，无法反推原始密钥。

### GET /api/auth/api-keys
列出所有 API 密钥（admin only）。按创建时间倒序排列，最多返回 100 条。

**Response:**
```json
{
  "success": true,
  "data": {
    "api_keys": [
      {
        "id": "audit-row-id",
        "label": "CI deploy",
        "api_key_prefix": "a1b2c3d4",
        "key_hash": "sha256-hex",
        "created_at": "2026-07-13T00:00:00Z",
        "expires_at": "2027-07-13T00:00:00Z",
        "revoked_at": null
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 审计行 ID |
| `label` | string | 管理员创建时提供的标签 |
| `api_key_prefix` | string | 原始密钥前 8 位，用于识别 |
| `key_hash` | string | 原始密钥的 SHA-256 hex，用于删除 |
| `created_at` | string | 创建时间（ISO 8601） |
| `expires_at` | string | 过期时间（当前固定为 1 年后） |
| `revoked_at` | string \| null | 撤销时间；仅旧数据保留，新数据删除后不再存在 |

### DELETE /api/auth/api-keys/:keyHash
删除 API 密钥（硬删除）。会同时删除 KV 中的 `apikey:{keyHash}` 和 D1 中的对应审计记录，并写入 `credential_deleted` 审计日志。

> 删除后该密钥立即失效，且无法恢复。

### PUT /api/admin/password
修改管理员密码。

**Body:** `{ "current_password": "...", "new_password": "..." }`（至少 8 位）

### GET /api/admin/config?key=roomTtlHours
获取管理配置（如房间过期 TTL）。

### PUT /api/admin/config
设置管理配置。

**Body:** `{ "key": "roomTtlHours", "value": "48" }`

---

## 公共文件

### GET /api/files/:id/public
获取公共文件（无需认证）。直接返回原始文件内容。

---

## 错误码

| 状态码 | Code | 含义 |
|--------|------|------|
| 400 | VALIDATION_ERROR | 请求参数不合法 |
| 401 | UNAUTHORIZED | 未认证或认证过期 |
| 403 | FORBIDDEN | 无权限（非房间成员/非管理员） |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 房间码已占用 |
| 410 | GONE | 资源已过期/已撤回 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

## 限流与轮询

当前版本未实现速率限制（TODO）。消息轮询可通过 `GET /api/chat/messages?room_id=...` 实现，建议间隔 2-5 秒。

WebSocket 是推荐的实时通信方式（使用 RoomDO + hibernatable 模式优化成本）。
