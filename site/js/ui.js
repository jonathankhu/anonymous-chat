// 畫面層：只認得聊天服務介面（join / send / leave 與事件），不碰 Supabase。
// 所有使用者提供的文字一律用 textContent 放進畫面，絕不使用 innerHTML。

import { EVENTS, ERRORS } from './chat-service.js';
import { LIMITS, ACCEPT_ATTRIBUTE, validateNickname, validateFile } from './rules.js';

const ERROR_TEXT = {
  [ERRORS.INVALID_NICKNAME]: '代號格式不正確',
  [ERRORS.NICKNAME_TAKEN]: '這個代號已有人使用，請換一個',
  [ERRORS.CONNECTION_FAILED]: '連線失敗，請稍後再試',
  [ERRORS.EMPTY]: '請輸入訊息或選擇檔案',
  [ERRORS.TOO_LONG]: `訊息不能超過 ${LIMITS.textMax} 字`,
  [ERRORS.RATE_LIMITED]: '送太快了，請稍等一下',
  [ERRORS.FILE_TOO_LARGE]: '檔案太大（上限 25MB）',
  [ERRORS.FILE_TYPE_NOT_ALLOWED]: '不支援這種檔案',
  [ERRORS.UPLOAD_FAILED]: '上傳失敗，請再試一次',
  [ERRORS.NOT_JOINED]: '尚未進入聊天室',
};

const NICKNAME_HINT = {
  TOO_LONG: `代號最多 ${LIMITS.nicknameMax} 個字`,
  BAD_CHARS: '代號只能使用中文、英文與數字',
};

const BOTTOM_THRESHOLD_PX = 48;
const TOAST_MS = 3000;

const $ = (id) => document.getElementById(id);
const countChars = (s) => [...s].length;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isSafeUrl(url) {
  return url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('https://');
}

export function mountUI(service) {
  const el = {
    entryScreen: $('screen-entry'),
    chatScreen: $('screen-chat'),
    entryForm: $('entry-form'),
    nickname: $('nickname-input'),
    entryError: $('entry-error'),
    enterBtn: $('enter-btn'),
    leaveBtn: $('leave-btn'),
    online: $('online-count'),
    scroller: $('scroller'),
    list: $('message-list'),
    emptyHint: $('empty-hint'),
    newMsgBtn: $('new-msg-btn'),
    composer: $('composer'),
    text: $('text-input'),
    sendBtn: $('send-btn'),
    attachBtn: $('attach-btn'),
    fileInput: $('file-input'),
    fileChip: $('file-chip'),
    fileChipName: $('file-chip-name'),
    fileRemoveBtn: $('file-remove-btn'),
    charHint: $('char-hint'),
    toast: $('toast'),
  };

  const state = { inChat: false, busy: false, file: null, toastTimer: 0 };
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  el.fileInput.accept = ACCEPT_ATTRIBUTE;

  // ---------- 小工具 ----------

  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, TOAST_MS);
  }

  const isAtBottom = () =>
    el.scroller.scrollHeight - el.scroller.scrollTop - el.scroller.clientHeight < BOTTOM_THRESHOLD_PX;

  function scrollToBottom() {
    el.scroller.scrollTop = el.scroller.scrollHeight;
    el.newMsgBtn.hidden = true;
  }

  function setOnline(count) {
    el.online.textContent = `目前 ${count} 人在線`;
  }

  // ---------- 畫面切換 ----------

  function showEntry(notice = '') {
    state.inChat = false;
    el.list.replaceChildren();
    el.emptyHint.hidden = false;
    el.newMsgBtn.hidden = true;
    clearFile();
    el.text.value = '';
    autoGrow();
    updateComposer();
    el.chatScreen.hidden = true;
    el.entryScreen.hidden = false;
    el.entryError.textContent = notice;
    el.enterBtn.textContent = '進入';
    state.busy = false;
    updateEntry({ keepNotice: Boolean(notice) });
    el.nickname.focus();
  }

  function showChat() {
    state.inChat = true;
    el.entryScreen.hidden = true;
    el.chatScreen.hidden = false;
    el.entryError.textContent = '';
    setOnline(1);
    el.text.focus();
  }

  // ---------- 畫面 A：輸入代號 ----------

  function updateEntry({ keepNotice = false } = {}) {
    const value = el.nickname.value.trim();
    const problem = validateNickname(value);
    el.enterBtn.disabled = problem !== null || state.busy;
    if (!keepNotice) el.entryError.textContent = problem ? NICKNAME_HINT[problem] ?? '' : '';
  }

  el.nickname.addEventListener('input', () => updateEntry());

  el.entryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const nickname = el.nickname.value.trim();
    if (validateNickname(nickname) !== null) return;

    state.busy = true;
    el.enterBtn.disabled = true;
    el.enterBtn.textContent = '進入中…';
    const result = await service.join(nickname);
    state.busy = false;
    el.enterBtn.textContent = '進入';

    if (!result.ok) {
      el.entryError.textContent = ERROR_TEXT[result.error] ?? '無法進入，請再試一次';
      el.enterBtn.disabled = false;
      return;
    }
    showChat();
  });

  // ---------- 畫面 B：訊息顯示 ----------

  function buildFileNode(file) {
    if (!isSafeUrl(file.url)) return null;

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'msg__image';
      img.alt = file.name;
      img.loading = 'lazy';
      img.src = file.url;
      img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'msg__file';
        fallback.textContent = `圖片無法載入：${file.name}`;
        img.replaceWith(fallback);
      });
      return img;
    }

    const link = document.createElement('a');
    link.className = 'msg__file';
    link.href = file.url;
    link.download = file.name;
    link.rel = 'noopener noreferrer';
    const name = document.createElement('span');
    name.className = 'msg__file-name';
    name.textContent = file.name;
    const size = document.createElement('span');
    size.className = 'msg__file-size';
    size.textContent = formatSize(file.size);
    link.append(name, size);
    return link;
  }

  function renderMessage(message) {
    const own = message.senderId === service.clientId;
    const wasAtBottom = isAtBottom();

    const item = document.createElement('li');
    item.className = `msg ${own ? 'msg--me' : 'msg--other'}`;

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const name = document.createElement('span');
    name.className = 'msg__name';
    name.textContent = message.nickname;
    const time = document.createElement('time');
    time.dateTime = message.sentAt;
    time.textContent = formatTime(message.sentAt);
    meta.append(name, time);
    item.append(meta);

    if (message.text.trim()) {
      const bubble = document.createElement('div');
      bubble.className = 'msg__bubble';
      bubble.textContent = message.text;
      item.append(bubble);
    }
    if (message.file) {
      const node = buildFileNode(message.file);
      if (node) {
        if (node.tagName === 'IMG') {
          node.addEventListener('load', () => { if (own || wasAtBottom) scrollToBottom(); });
        }
        item.append(node);
      }
    }

    appendItem(item, { stick: own || wasAtBottom, unread: !own });
  }

  function renderNotice(text) {
    const item = document.createElement('li');
    item.className = 'notice';
    item.textContent = text;
    appendItem(item, { stick: isAtBottom(), unread: false });
  }

  function appendItem(item, { stick, unread }) {
    el.list.append(item);
    el.emptyHint.hidden = true;
    if (stick) scrollToBottom();
    else if (unread) el.newMsgBtn.hidden = false;
  }

  el.scroller.addEventListener('scroll', () => {
    if (isAtBottom()) el.newMsgBtn.hidden = true;
  });
  el.newMsgBtn.addEventListener('click', scrollToBottom);

  // ---------- 畫面 B：輸入與送出 ----------

  function autoGrow() {
    el.text.style.height = 'auto';
    el.text.style.height = `${Math.min(el.text.scrollHeight, 140)}px`;
  }

  function updateComposer() {
    const len = countChars(el.text.value);
    const remaining = LIMITS.textMax - len;
    const over = remaining < 0;
    el.charHint.textContent = remaining <= 100 ? `剩 ${remaining} 字` : '';
    el.charHint.classList.toggle('composer__hint--over', over);

    const hasContent = el.text.value.trim().length > 0 || state.file !== null;
    el.sendBtn.disabled = state.busy || over || !hasContent;
  }

  function clearFile() {
    state.file = null;
    el.fileInput.value = '';
    el.fileChip.hidden = true;
    el.fileChipName.textContent = '';
  }

  el.text.addEventListener('input', () => { autoGrow(); updateComposer(); });

  el.text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    if (coarsePointer) return; // 手機上 Enter 是換行，用「送出」按鈕送出
    event.preventDefault();
    if (!el.sendBtn.disabled) el.composer.requestSubmit();
  });

  el.attachBtn.addEventListener('click', () => el.fileInput.click());

  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    if (!file) return;
    const problem = validateFile(file);
    if (problem) {
      toast(ERROR_TEXT[problem]);
      clearFile();
    } else {
      state.file = file;
      el.fileChipName.textContent = `${file.name}（${formatSize(file.size)}）`;
      el.fileChip.hidden = false;
    }
    updateComposer();
  });

  el.fileRemoveBtn.addEventListener('click', () => { clearFile(); updateComposer(); });

  el.composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy || el.sendBtn.disabled) return;

    const text = el.text.value;
    const file = state.file;
    state.busy = true;
    el.sendBtn.textContent = file ? '上傳中' : '送出';
    updateComposer();

    const result = await service.send({ text, file });

    state.busy = false;
    el.sendBtn.textContent = '送出';
    if (!result.ok) {
      toast(ERROR_TEXT[result.error] ?? '送出失敗，請再試一次');
    } else {
      el.text.value = '';
      clearFile();
      autoGrow();
    }
    updateComposer();
    if (!coarsePointer) el.text.focus();
  });

  el.leaveBtn.addEventListener('click', async () => {
    await service.leave();
    showEntry();
  });

  // ---------- 服務事件 ----------

  service.on(EVENTS.MESSAGE, (message) => { if (state.inChat) renderMessage(message); });
  service.on(EVENTS.ONLINE_COUNT, ({ count }) => { if (state.inChat) setOnline(count); });
  service.on(EVENTS.SOMEONE_JOINED, () => { if (state.inChat) renderNotice('有人進來了'); });
  service.on(EVENTS.SOMEONE_LEFT, () => { if (state.inChat) renderNotice('有人離開了'); });
  service.on(EVENTS.CONNECTION_LOST, () => {
    if (state.inChat) showEntry('連線中斷，請重新進入');
  });

  showEntry();
}
