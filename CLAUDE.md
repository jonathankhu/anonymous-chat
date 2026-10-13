# CLAUDE.md

## 專案

一個不用登入的匿名聊天室：網頁放在 GitHub Pages，即時傳訊與檔案透過 Supabase。

## 工作守則

- 開始任何工作前，先讀 `docs/architecture.md`（需求在 `docs/requirements.md`）。
- 目前在「**階段一**」：只做前端，用模擬聊天服務，**不接 Supabase**。
- 不可以把金鑰檔案 commit 進 git（`site/js/config.js`、`.env*`、`*.key`、`*.pem`、`service_role*`）。只有假值的 `config.example.js` 可以 commit。
