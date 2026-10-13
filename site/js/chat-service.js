// 聊天服務介面的約定（見 docs/architecture.md 第 4.3、5 節）。
// 畫面層只認得這份約定。階段一用 MockChatService，階段二換成 SupabaseChatService。

export const EVENTS = Object.freeze({
  MESSAGE: 'message',               // 資料：訊息物件（含自己送的）
  ONLINE_COUNT: 'online-count',     // 資料：{ count }
  SOMEONE_JOINED: 'someone-joined', // 無資料（不含名字）
  SOMEONE_LEFT: 'someone-left',     // 無資料（不含名字）
  CONNECTION_LOST: 'connection-lost', // 資料：{ reason }
});

export const ERRORS = Object.freeze({
  INVALID_NICKNAME: 'INVALID_NICKNAME',
  NICKNAME_TAKEN: 'NICKNAME_TAKEN',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  EMPTY: 'EMPTY',
  TOO_LONG: 'TOO_LONG',
  RATE_LIMITED: 'RATE_LIMITED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  NOT_JOINED: 'NOT_JOINED',
});

/**
 * 訊息資料格式：
 * { id, senderId, nickname, text, file: null | { url, name, type, size }, sentAt }
 *
 * join / send 都回傳 { ok: true } 或 { ok: false, error: ERRORS.* }，不拋例外。
 */
export class ChatService {
  constructor() {
    this._handlers = new Map();
    this.clientId = getOrCreateClientId();
  }

  /** 訂閱事件，回傳取消訂閱的函式。 */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this._handlers.get(event)?.delete(handler);
  }

  emit(event, data) {
    this._handlers.get(event)?.forEach((h) => h(data));
  }

  // eslint-disable-next-line no-unused-vars
  async join(nickname) { throw new Error('join() 尚未實作'); }
  // eslint-disable-next-line no-unused-vars
  async send({ text, file }) { throw new Error('send() 尚未實作'); }
  async leave() { throw new Error('leave() 尚未實作'); }
}

export function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 每個分頁一個連線編號，存在該分頁內，關掉分頁就消失。 */
export function getOrCreateClientId() {
  const KEY = 'anonymous-chat.clientId';
  try {
    const existing = globalThis.sessionStorage?.getItem(KEY);
    if (existing) return existing;
    const created = randomId();
    globalThis.sessionStorage?.setItem(KEY, created);
    return created;
  } catch {
    return randomId();
  }
}
