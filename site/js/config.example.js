// 設定範例（假值，可以 commit）。
// 真正的 config.js 已被 .gitignore 排除；GitHub Pages 發布時由 deploy.yml 自動產生。
// 本機要測試階段二時，複製這個檔案成 config.js 再填入自己的值。
//
// backend: 'mock'     階段一，模擬聊天服務（不需要任何金鑰）
// backend: 'supabase' 階段二，使用 Supabase
//
// supabaseAnonKey 是「公開」金鑰，可以放在網頁裡。
// service_role / secret key 絕對不要放在這裡。

export const config = {
  backend: 'mock',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
