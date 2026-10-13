// 階段一：模擬聊天服務。
// 同一個瀏覽器的多個分頁透過 BroadcastChannel 互相傳話，每個分頁就是一個「人」。
// 網址加 ?demo=1 時，會有幾個示範訪客偶爾發言與進出。

import { ChatService, EVENTS, ERRORS, randomId } from './chat-service.js';
import {
  validateNickname,
  validateOutgoing,
  nicknameKey,
  createRateLimiter,
  isValidMessage,
  resolveFileType,
} from './rules.js';

const CHANNEL_NAME = 'anonymous-chat-room';
const HEARTBEAT_MS = 3000;
const EXPIRE_MS = 10_000;
const WHO_WAIT_MS = 350;

const BOT_NAMES = ['小明', 'Amy', '阿華'];
const BOT_LINES = [
  '大家好', '今天天氣不錯', '有人在嗎？', '哈哈哈', '剛下班',
  '這裡好安靜', 'Hello everyone', '晚餐吃什麼好', '收到', '真的假的',
];

// 模擬版只信任自己產生的 data: 網址
const isAllowedMockUrl = (url) => url.startsWith('data:');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export class MockChatService extends ChatService {
  constructor({ demo = false } = {}) {
    super();
    this._demo = demo;
    this._joined = false;
    this._nickname = null;
    this._joinedAt = 0;
    this._channel = null;
    this._peers = new Map();   // clientId → { nickname, joinedAt, lastSeen }
    this._bots = new Set();    // 示範訪客目前在線的名字
    this._rate = createRateLimiter();
    this._inbound = new Map(); // senderId → 頻率限制器（接收端防洗版）
    this._timers = new Set();
    this._onPageHide = () => this._post({ kind: 'bye', clientId: this.clientId });
    this._onOffline = () => this._connectionLost('瀏覽器已離線');
  }

  // ---- 約定的三個動作 ----

  async join(nickname) {
    if (validateNickname(nickname) !== null) return fail(ERRORS.INVALID_NICKNAME);
    if (typeof BroadcastChannel === 'undefined') return fail(ERRORS.CONNECTION_FAILED);

    this._open();
    this._peers.clear();
    this._post({ kind: 'who' });
    await sleep(WHO_WAIT_MS);

    const key = nicknameKey(nickname);
    const taken = [...this._peers.entries()].some(
      ([id, p]) => id !== this.clientId && nicknameKey(p.nickname) === key,
    );
    if (taken) {
      this._close();
      return fail(ERRORS.NICKNAME_TAKEN);
    }

    this._nickname = nickname;
    this._joinedAt = Date.now();
    this._joined = true;
    this._announce();
    this._timer(setInterval(() => this._heartbeat(), HEARTBEAT_MS));
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('offline', this._onOffline);

    if (this._demo) this._startBots(key);
    this._emitCount();
    return { ok: true };
  }

  async send({ text = '', file = null } = {}) {
    if (!this._joined) return fail(ERRORS.NOT_JOINED);
    const invalid = validateOutgoing({ text, file });
    if (invalid) return fail(invalid);
    if (!this._rate.tryAcquire()) return fail(ERRORS.RATE_LIMITED);

    let fileInfo = null;
    if (file) {
      try {
        fileInfo = {
          url: await readAsDataUrl(file),
          name: file.name,
          type: resolveFileType(file),
          size: file.size,
        };
      } catch {
        return fail(ERRORS.UPLOAD_FAILED);
      }
    }

    const message = {
      id: randomId(),
      senderId: this.clientId,
      nickname: this._nickname,
      text,
      file: fileInfo,
      sentAt: new Date().toISOString(),
    };
    this._post({ kind: 'message', message });
    this.emit(EVENTS.MESSAGE, message); // BroadcastChannel 不會回傳給自己
    return { ok: true };
  }

  async leave() {
    if (this._joined) this._post({ kind: 'bye', clientId: this.clientId });
    this._teardown();
  }

  // ---- 內部 ----

  _open() {
    if (this._channel) return;
    this._channel = new BroadcastChannel(CHANNEL_NAME);
    this._channel.onmessage = (e) => this._onChannel(e.data);
  }

  _close() {
    this._channel?.close();
    this._channel = null;
  }

  _post(data) {
    try { this._channel?.postMessage(data); } catch { /* 忽略 */ }
  }

  _timer(id) {
    this._timers.add(id);
    return id;
  }

  _teardown() {
    this._joined = false;
    this._nickname = null;
    this._timers.forEach((id) => { clearInterval(id); clearTimeout(id); });
    this._timers.clear();
    this._peers.clear();
    this._bots.clear();
    this._inbound.clear();
    window.removeEventListener('pagehide', this._onPageHide);
    window.removeEventListener('offline', this._onOffline);
    this._close();
  }

  _connectionLost(reason) {
    if (!this._joined) return;
    this._teardown();
    this.emit(EVENTS.CONNECTION_LOST, { reason });
  }

  _announce() {
    this._post({
      kind: 'hello',
      clientId: this.clientId,
      nickname: this._nickname,
      joinedAt: this._joinedAt,
    });
  }

  _heartbeat() {
    this._announce();
    const now = Date.now();
    for (const [id, p] of this._peers) {
      if (now - p.lastSeen > EXPIRE_MS) {
        this._peers.delete(id);
        this.emit(EVENTS.SOMEONE_LEFT);
        this._emitCount();
      }
    }
  }

  _emitCount() {
    this.emit(EVENTS.ONLINE_COUNT, { count: 1 + this._peers.size + this._bots.size });
  }

  _onChannel(data) {
    if (!data || typeof data !== 'object' || data.clientId === this.clientId) return;

    switch (data.kind) {
      case 'who':
        if (this._joined) this._announce();
        break;

      case 'hello': {
        if (typeof data.clientId !== 'string' || validateNickname(data.nickname) !== null) return;
        const known = this._peers.has(data.clientId);
        this._peers.set(data.clientId, {
          nickname: data.nickname,
          joinedAt: data.joinedAt,
          lastSeen: Date.now(),
        });
        if (!known && this._joined) {
          this.emit(EVENTS.SOMEONE_JOINED);
          this._emitCount();
        }
        break;
      }

      case 'bye':
        if (this._peers.delete(data.clientId) && this._joined) {
          this.emit(EVENTS.SOMEONE_LEFT);
          this._emitCount();
        }
        break;

      case 'message': {
        if (!this._joined) return;
        const m = data.message;
        if (!isValidMessage(m, { isAllowedUrl: isAllowedMockUrl })) return;
        if (m.senderId === this.clientId) return;
        // 接收端也做頻率限制，同一個傳送者超過就丟棄
        if (!this._inbound.has(m.senderId)) this._inbound.set(m.senderId, createRateLimiter());
        if (!this._inbound.get(m.senderId).tryAcquire()) return;
        this.emit(EVENTS.MESSAGE, m);
        break;
      }

      default:
        break;
    }
  }

  // ---- 示範訪客 ----

  _startBots(userKey) {
    const names = BOT_NAMES.filter((n) => nicknameKey(n) !== userKey);
    this._botPool = names;
    names.slice(0, 2).forEach((n) => this._bots.add(n));

    const tick = () => {
      if (!this._joined) return;
      const r = Math.random();
      const absent = this._botPool.filter((n) => !this._bots.has(n));
      const present = [...this._bots];

      if (r < 0.6 && present.length) {
        const name = pick(present);
        this.emit(EVENTS.MESSAGE, {
          id: randomId(),
          senderId: `bot-${name}`,
          nickname: name,
          text: pick(BOT_LINES),
          file: null,
          sentAt: new Date().toISOString(),
        });
      } else if (r < 0.8 && present.length) {
        this._bots.delete(pick(present));
        this.emit(EVENTS.SOMEONE_LEFT);
        this._emitCount();
      } else if (absent.length) {
        this._bots.add(pick(absent));
        this.emit(EVENTS.SOMEONE_JOINED);
        this._emitCount();
      }
      this._timer(setTimeout(tick, 4000 + Math.random() * 5000));
    };
    this._timer(setTimeout(tick, 3000));
  }
}

function fail(error) {
  return { ok: false, error };
}
