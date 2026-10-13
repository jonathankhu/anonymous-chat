// 共用規則：代號格式、長度、檔案類型、頻率。
// 畫面層與兩個聊天服務都從這裡取用，確保規則只有一份。

export const LIMITS = Object.freeze({
  nicknameMax: 20,
  textMax: 500,
  fileMaxBytes: 25 * 1024 * 1024,
  rateMax: 5,
  rateWindowMs: 10_000,
});

// 允許的檔案類型 → 對應的副檔名（不允許 SVG）
export const ALLOWED_FILE_TYPES = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
});

export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_FILE_TYPES).join(',');

const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9]+$/u;

const length = (s) => [...s].length;

/** 回傳 null 代表通過，否則回傳原因代碼。 */
export function validateNickname(nickname) {
  if (typeof nickname !== 'string' || nickname.length === 0) return 'EMPTY';
  if (length(nickname) > LIMITS.nicknameMax) return 'TOO_LONG';
  if (!NICKNAME_PATTERN.test(nickname)) return 'BAD_CHARS';
  return null;
}

/** 比對代號是否重複時使用（忽略大小寫）。 */
export function nicknameKey(nickname) {
  return nickname.toLowerCase();
}

/** 取得檔案的有效 MIME 類型；不在允許清單內回傳 null。 */
export function resolveFileType(file) {
  if (file.type && ALLOWED_FILE_TYPES[file.type]) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  for (const [type, exts] of Object.entries(ALLOWED_FILE_TYPES)) {
    if (!file.type && exts.includes(ext)) return type;
  }
  return null;
}

export function validateFile(file) {
  if (!resolveFileType(file)) return 'FILE_TYPE_NOT_ALLOWED';
  if (file.size > LIMITS.fileMaxBytes) return 'FILE_TOO_LARGE';
  return null;
}

/** 送出前檢查文字與檔案。 */
export function validateOutgoing({ text = '', file = null } = {}) {
  if (text.trim().length === 0 && !file) return 'EMPTY';
  if (length(text) > LIMITS.textMax) return 'TOO_LONG';
  if (file) return validateFile(file);
  return null;
}

/** 滑動視窗頻率限制：windowMs 內最多 max 次。 */
export function createRateLimiter({
  max = LIMITS.rateMax,
  windowMs = LIMITS.rateWindowMs,
  now = () => Date.now(),
} = {}) {
  let stamps = [];
  return {
    tryAcquire() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    },
  };
}

const isString = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;

/**
 * 驗證「收到」的訊息資料（不信任任何來源）。
 * isAllowedUrl：由各聊天服務提供，決定檔案網址是否可信。
 */
export function isValidMessage(m, { isAllowedUrl = () => false } = {}) {
  if (!m || typeof m !== 'object') return false;
  if (!isString(m.id, 1, 64) || !isString(m.senderId, 1, 64)) return false;
  if (!isString(m.nickname, 1, 80) || validateNickname(m.nickname) !== null) return false;
  if (typeof m.text !== 'string' || length(m.text) > LIMITS.textMax) return false;
  if (!isString(m.sentAt, 1, 40) || Number.isNaN(Date.parse(m.sentAt))) return false;

  const f = m.file;
  if (f !== null && f !== undefined) {
    if (typeof f !== 'object') return false;
    if (!isString(f.url, 1, 40_000_000) || !isAllowedUrl(f.url)) return false;
    if (!isString(f.name, 1, 255)) return false;
    if (!ALLOWED_FILE_TYPES[f.type]) return false;
    if (!Number.isInteger(f.size) || f.size < 0 || f.size > LIMITS.fileMaxBytes) return false;
  }

  if (m.text.trim().length === 0 && !f) return false;
  return true;
}
