// 程式入口：決定用「模擬服務」還是「Supabase 服務」，再把它交給畫面層。
// 階段二只需要在這裡（與設定檔）切換，畫面層不用改。

import { MockChatService } from './mock-chat-service.js';
import { mountUI } from './ui.js';

async function loadConfig() {
  try {
    const mod = await import('./config.js');
    return mod.config ?? {};
  } catch {
    return { backend: 'mock' }; // 沒有設定檔就一律用模擬版
  }
}

async function createService(config, params) {
  if (config.backend === 'supabase') {
    try {
      const { SupabaseChatService } = await import('./supabase-chat-service.js');
      return new SupabaseChatService({
        url: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
      });
    } catch (err) {
      console.warn('Supabase 服務無法啟動，改用模擬版：', err);
    }
  }
  return new MockChatService({ demo: params.get('demo') === '1' });
}

const params = new URLSearchParams(window.location.search);
const config = await loadConfig();
const service = await createService(config, params);
mountUI(service);
