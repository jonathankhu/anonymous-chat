// 階段二才會實作：用 Supabase Realtime（Broadcast + Presence）與 Storage 實作同一份聊天服務約定。
// 階段一不安裝、也不連接 Supabase；這個檔案只是預留位置，main.js 不會在 mock 模式下載入它。
//
// 實作時要遵守 chat-service.js 的約定：
//   join(nickname) / send({ text, file }) / leave()
//   事件：message、online-count、someone-joined、someone-left、connection-lost
// 並且使用 rules.js 的 isValidMessage() 驗證收到的每一則訊息，
// isAllowedUrl 只接受自己專案的 Storage 網址。

import { ChatService } from './chat-service.js';

export class SupabaseChatService extends ChatService {
  constructor() {
    super();
    throw new Error('SupabaseChatService 尚未實作（階段二）');
  }
}
