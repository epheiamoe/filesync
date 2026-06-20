/**
 * epheia-files i18n — Simple translation system.
 *
 * All user-facing strings go through t(key) to enable future multi-language support.
 * Default language: zh-CN. Fallback: en-US.
 *
 * Usage:
 *   import { t } from '@/i18n';
 *   <h1>{t('login.title')}</h1>
 */

type Translations = Record<string, Record<string, string>>;

const translations: Translations = {
  // ---- Common ----
  'common.loading': { 'zh-CN': '加载中...', 'en-US': 'Loading...' },
  'common.error': { 'zh-CN': '出错了', 'en-US': 'Error' },
  'common.retry': { 'zh-CN': '重试', 'en-US': 'Retry' },
  'common.cancel': { 'zh-CN': '取消', 'en-US': 'Cancel' },
  'common.confirm': { 'zh-CN': '确认', 'en-US': 'Confirm' },
  'common.save': { 'zh-CN': '保存', 'en-US': 'Save' },
  'common.delete': { 'zh-CN': '删除', 'en-US': 'Delete' },
  'common.copy': { 'zh-CN': '复制', 'en-US': 'Copy' },
  'common.copied': { 'zh-CN': '已复制', 'en-US': 'Copied' },
  'common.back': { 'zh-CN': '返回', 'en-US': 'Back' },
  'common.close': { 'zh-CN': '关闭', 'en-US': 'Close' },
  'common.expand': { 'zh-CN': '展开', 'en-US': 'Expand' },
  'common.collapse': { 'zh-CN': '收起', 'en-US': 'Collapse' },
  'common.empty': { 'zh-CN': '暂无数据', 'en-US': 'No data' },
  'common.offline': { 'zh-CN': '您当前处于离线状态', 'en-US': 'You are currently offline' },

  // ---- Login ----
  'login.title': { 'zh-CN': '登录', 'en-US': 'Login' },
  'login.subtitle': { 'zh-CN': '安全的端到端加密文件传输与即时通讯', 'en-US': 'Secure end-to-end encrypted file transfer & chat' },
  'login.tabAdmin': { 'zh-CN': '管理员', 'en-US': 'Admin' },
  'login.tabApiKey': { 'zh-CN': 'API 密钥', 'en-US': 'API Key' },
  'login.tabTemp': { 'zh-CN': '临时凭证', 'en-US': 'Temp Credential' },
  'login.username': { 'zh-CN': '用户名', 'en-US': 'Username' },
  'login.password': { 'zh-CN': '密码', 'en-US': 'Password' },
  'login.apiKey': { 'zh-CN': 'API 密钥', 'en-US': 'API Key' },
  'login.tempCode': { 'zh-CN': '临时凭证码', 'en-US': 'Temp Code' },
  'login.button': { 'zh-CN': '登录', 'en-US': 'Login' },
  'login.error': { 'zh-CN': '登录失败，请检查凭证', 'en-US': 'Login failed, please check credentials' },

  // ---- Rooms ----
  'rooms.title': { 'zh-CN': '房间', 'en-US': 'Rooms' },
  'rooms.create': { 'zh-CN': '创建新房间', 'en-US': 'Create Room' },
  'rooms.join': { 'zh-CN': '加入房间', 'en-US': 'Join Room' },
  'rooms.roomCode': { 'zh-CN': '房间码', 'en-US': 'Room Code' },
  'rooms.roomCodePlaceholder': { 'zh-CN': '4位房间码', 'en-US': '4-digit code' },
  'rooms.customCode': { 'zh-CN': '自定义房间码（可选）', 'en-US': 'Custom code (optional)' },
  'rooms.shareKey': { 'zh-CN': '分享密钥', 'en-US': 'Share Key' },
  'rooms.shareKeyPlaceholder': { 'zh-CN': '粘贴分享字符串', 'en-US': 'Paste share string' },
  'rooms.members': { 'zh-CN': '成员', 'en-US': 'Members' },
  'rooms.files': { 'zh-CN': '文件', 'en-US': 'Files' },
  'rooms.online': { 'zh-CN': '在线', 'en-US': 'Online' },
  'rooms.leave': { 'zh-CN': '离开房间', 'en-US': 'Leave Room' },
  'rooms.shareString': { 'zh-CN': '分享字符串', 'en-US': 'Share String' },
  'rooms.copyShare': { 'zh-CN': '复制分享字符串', 'en-US': 'Copy Share String' },
  'rooms.exportKey': { 'zh-CN': '导出密钥', 'en-US': 'Export Key' },
  'rooms.created': { 'zh-CN': '已创建', 'en-US': 'Created' },
  'rooms.noRooms': { 'zh-CN': '还没有房间，创建一个吧', 'en-US': 'No rooms yet, create one' },
  'rooms.keyMismatch': { 'zh-CN': '密钥不匹配', 'en-US': 'Key mismatch' },
  'rooms.roomNotFound': { 'zh-CN': '房间不存在', 'en-US': 'Room not found' },

  // ---- Chat ----
  'chat.title': { 'zh-CN': '聊天', 'en-US': 'Chat' },
  'chat.placeholder': { 'zh-CN': '输入消息...', 'en-US': 'Type a message...' },
  'chat.send': { 'zh-CN': '发送', 'en-US': 'Send' },
  'chat.recall': { 'zh-CN': '撤回', 'en-US': 'Recall' },
  'chat.recalled': { 'zh-CN': '已撤回', 'en-US': 'Recalled' },
  'chat.loadMore': { 'zh-CN': '加载更多', 'en-US': 'Load more' },
  'chat.noMessages': { 'zh-CN': '暂无消息，发送第一条吧', 'en-US': 'No messages yet, send one' },
  'chat.attachFile': { 'zh-CN': '附加文件', 'en-US': 'Attach file' },

  // ---- Transfer ----
  'transfer.title': { 'zh-CN': '传输', 'en-US': 'Transfer' },
  'transfer.texts': { 'zh-CN': '文本', 'en-US': 'Texts' },
  'transfer.files': { 'zh-CN': '文件', 'en-US': 'Files' },
  'transfer.download': { 'zh-CN': '下载', 'en-US': 'Download' },
  'transfer.open': { 'zh-CN': '打开', 'en-US': 'Open' },
  'transfer.upload': { 'zh-CN': '上传', 'en-US': 'Upload' },
  'transfer.uploading': { 'zh-CN': '上传中...', 'en-US': 'Uploading...' },
  'transfer.dragDrop': { 'zh-CN': '拖拽文件到此处或点击上传', 'en-US': 'Drag files here or click to upload' },
  'transfer.pasteHint': { 'zh-CN': '也可以直接粘贴文件', 'en-US': 'You can also paste files' },
  'transfer.maxSize': { 'zh-CN': '房间总容量 5GB', 'en-US': 'Room limit 5GB' },
  'transfer.batchDelete': { 'zh-CN': '批量删除', 'en-US': 'Batch Delete' },
  'transfer.filterAll': { 'zh-CN': '全部', 'en-US': 'All' },
  'transfer.filterImage': { 'zh-CN': '图片', 'en-US': 'Images' },
  'transfer.filterVideo': { 'zh-CN': '视频', 'en-US': 'Videos' },
  'transfer.filterDoc': { 'zh-CN': '文档', 'en-US': 'Documents' },
  'transfer.filterOther': { 'zh-CN': '其他', 'en-US': 'Other' },
  'transfer.filterPrivate': { 'zh-CN': '私密', 'en-US': 'Private' },
  'transfer.filterPublic': { 'zh-CN': '公开', 'en-US': 'Public' },
  'transfer.expires': { 'zh-CN': '过期时间', 'en-US': 'Expires' },
  'transfer.expired': { 'zh-CN': '已过期', 'en-US': 'Expired' },
  'transfer.sizeUnknown': { 'zh-CN': '未知大小', 'en-US': 'Unknown size' },
  'transfer.noTexts': { 'zh-CN': '暂无文本', 'en-US': 'No texts' },
  'transfer.noFiles': { 'zh-CN': '暂无文件', 'en-US': 'No files' },

  // ---- Admin ----
  'admin.title': { 'zh-CN': '管理面板', 'en-US': 'Admin Panel' },
  'admin.stats': { 'zh-CN': '统计', 'en-US': 'Stats' },
  'admin.r2Usage': { 'zh-CN': 'R2 用量', 'en-US': 'R2 Usage' },
  'admin.fileCount': { 'zh-CN': '文件总数', 'en-US': 'File Count' },
  'admin.roomCount': { 'zh-CN': '房间数', 'en-US': 'Room Count' },
  'admin.activeSessions': { 'zh-CN': '活跃会话', 'en-US': 'Active Sessions' },
  'admin.credentials': { 'zh-CN': '凭证管理', 'en-US': 'Credentials' },
  'admin.createCredential': { 'zh-CN': '创建临时凭证', 'en-US': 'Create Temp Credential' },
  'admin.credentialCode': { 'zh-CN': '凭证码', 'en-US': 'Credential Code' },
  'admin.credentialType': { 'zh-CN': '类型', 'en-US': 'Type' },
  'admin.credentialStatus': { 'zh-CN': '状态', 'en-US': 'Status' },
  'admin.credentialActive': { 'zh-CN': '有效', 'en-US': 'Active' },
  'admin.credentialUsed': { 'zh-CN': '已使用', 'en-US': 'Used' },
  'admin.credentialRevoked': { 'zh-CN': '已撤销', 'en-US': 'Revoked' },
  'admin.credentialExpired': { 'zh-CN': '已过期', 'en-US': 'Expired' },
  'admin.revoke': { 'zh-CN': '撤销', 'en-US': 'Revoke' },
  'admin.roomManagement': { 'zh-CN': '房间管理', 'en-US': 'Room Management' },
  'admin.destroyRoom': { 'zh-CN': '销毁房间', 'en-US': 'Destroy Room' },
  'admin.destroyConfirm': { 'zh-CN': '确定要销毁此房间吗？此操作不可撤销，将删除所有消息和文件。', 'en-US': 'Are you sure you want to destroy this room? This action cannot be undone and will delete all messages and files.' },
  'admin.destroyed': { 'zh-CN': '房间已销毁', 'en-US': 'Room destroyed' },

  // ---- E2EE ----
  'e2ee.keyGenerated': { 'zh-CN': '密钥已生成', 'en-US': 'Key Generated' },
  'e2ee.saveKey': { 'zh-CN': '请妥善保管此密钥，它无法恢复', 'en-US': 'Please save this key, it cannot be recovered' },
  'e2ee.decryptError': { 'zh-CN': '解密失败', 'en-US': 'Decryption failed' },
  'e2ee.encryptError': { 'zh-CN': '加密失败', 'en-US': 'Encryption failed' },

  // ---- Logout ----
  'logout.button': { 'zh-CN': '退出登录', 'en-US': 'Logout' },
  'logout.confirm': { 'zh-CN': '确定退出登录？', 'en-US': 'Logout?' },
};

/**
 * Detect user language preference.
 * Priority: localStorage > navigator.language > default 'zh-CN'
 */
function detectLanguage(): string {
  try {
    const stored = localStorage.getItem('epheia_lang');
    if (stored && (stored === 'zh-CN' || stored === 'en-US')) {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR / private mode)
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.startsWith('zh')) return 'zh-CN';
    if (navigator.language.startsWith('en')) return 'en-US';
  }

  return 'zh-CN';
}

let currentLang: string = 'zh-CN';

/**
 * Set the current language.
 * Persists to localStorage and updates runtime.
 */
export function setLanguage(lang: string): void {
  if (lang !== 'zh-CN' && lang !== 'en-US') return;
  currentLang = lang;
  try {
    localStorage.setItem('epheia_lang', lang);
  } catch {
    // ignore
  }
}

/**
 * Get the current language.
 */
export function getLanguage(): string {
  return currentLang;
}

/**
 * Initialize i18n. Call once at app startup.
 */
export function initI18n(): void {
  currentLang = detectLanguage();
}

/**
 * Translate a key to the current language.
 * Falls back to 'en-US' if the key is missing for current language,
 * then to the key itself as last resort.
 *
 * @param key - Translation key (e.g. 'login.title')
 * @returns Translated string
 */
export function t(key: string): string {
  const entry = translations[key];
  if (!entry) {
    // Key not found in translations — return key as fallback
    console.warn(`[i18n] Missing translation for key: "${key}"`);
    return key;
  }

  // Try current language first
  if (entry[currentLang]) {
    return entry[currentLang];
  }

  // Fallback to English
  if (entry['en-US']) {
    return entry['en-US'];
  }

  // Last resort
  console.warn(`[i18n] No translation for key: "${key}" in lang: "${currentLang}"`);
  return key;
}

export type { Translations };
