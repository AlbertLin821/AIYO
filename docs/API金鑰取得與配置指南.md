# API 金鑰取得與配置指南

**文件版本**：1.0  
**建立日期**：2026-02-15  
**適用專案**：AIYO 愛遊互動式旅遊網站

---

## 1. 文件目的

本文件說明 AIYO 專案所需各項 API 金鑰的取得方式、啟用步驟與配置方法，供開發團隊在開發與部署前完成設定。

---

## 2. YouTube Data API v3

### 2.1 功能用途

- 搜尋旅遊影片（`search.list`）
- 取得影片 metadata（標題、頻道、長度、觀看數等）
- 取得影片字幕列表（`captions.list`）

### 2.2 取得步驟

1. **前往 Google Cloud Console**

   - 網址：https://console.cloud.google.com/
   - 使用 Google 帳號登入

2. **建立或選擇專案**

   - 點選頂部專案下拉選單
   - 點選「新增專案」
   - 輸入專案名稱（例如：AIYO）
   - 點選「建立」

3. **啟用 YouTube Data API v3**

   - 左側選單： APIs 與服務 > 程式庫
   - 搜尋「YouTube Data API v3」
   - 點選進入後，點擊「啟用」

4. **建立 API 金鑰**

   - 左側選單：APIs 與服務 > 憑證
   - 點選「建立憑證」>「API 金鑰」
   - 複製產生的 API 金鑰

5. **設定環境變數**

   ```
   YOUTUBE_API_KEY=您複製的 API 金鑰
   ```

### 2.3 配額限制

- 每日預設配額：10,000 單位
- `search.list`：100 單位/次
- `videos.list`：1 單位/次
- 開發階段通常足夠，正式上線可申請提高配額

### 2.4 參考文件

- 官方文件：https://developers.google.com/youtube/v3
- API 參考：https://developers.google.com/youtube/v3/docs

---

## 3. YouTube Captions API（字幕下載）

### 3.1 功能用途

- 取得影片可用字幕列表（`captions.list`）
- 下載 SRT/VTT 格式字幕（`captions.download`）

### 3.2 取得方式

YouTube 字幕功能與 **YouTube Data API v3** 使用同一金鑰，無需另外申請。

僅需確認已啟用 **YouTube Data API v3**，同上節步驟。

### 3.3 注意事項

- 部分影片可能無字幕
- 下載字幕需透過 OAuth 2.0 或影片擁有者授權，公開字幕可透過第三方套件（如 youtube-transcript-api）取得，可依實作選擇

### 3.4 參考文件

- captions 資源：https://developers.google.com/youtube/v3/docs/captions

---

## 4. Google Maps API（Places、Directions、Distance Matrix）

### 4.1 功能用途

- **Places API**：依景點名稱取得座標、地址、開放時間
- **Directions API**：取得兩點間導航路線與時間
- **Distance Matrix API**：計算多景點間行車/步行時間與距離（用於行程優化）

### 4.2 取得步驟

1. **使用同一 Google Cloud 專案**

   - 可沿用 YouTube API 的專案，或另建新專案

2. **啟用所需 API**

   - APIs 與服務 > 程式庫
   - 搜尋並啟用以下三者：
     - **Places API**
     - **Directions API**
     - **Distance Matrix API**

3. **建立 API 金鑰**

   - 若已建立金鑰可共用，或新建專用金鑰
   - APIs 與服務 > 憑證 > 建立憑證 > API 金鑰

4. **限制金鑰（建議）**

   - 點選該金鑰進入編輯
   - 「應用程式限制」：可設為 IP 或 HTTP referrer
   - 「API 限制」：勾選僅允許 Places API、Directions API、Distance Matrix API

5. **設定環境變數**

   ```
   GOOGLE_MAPS_API_KEY=您複製的 API 金鑰
   ```

### 4.3  billing 帳戶

- Google Maps API 為付費服務，需連結 billing 帳戶
- 新帳戶有免費額度（每月約 200 美元）
- 開發與小規模使用通常在免費額度內

### 4.4 參考文件

- Places API：https://developers.google.com/maps/documentation/places/web-service
- Directions API：https://developers.google.com/maps/documentation/directions
- Distance Matrix API：https://developers.google.com/maps/documentation/distance-matrix

---

## 5. OpenAI Whisper API（語音轉文字，選用）

### 5.1 功能用途

- 當影片無字幕時，以 Whisper 將音訊轉為文字
- 取得時間戳記供片段切割使用

### 5.2 取得方式（若使用 OpenAI API）

1. **註冊 OpenAI 帳號**

   - 網址：https://platform.openai.com/
   - 完成註冊與驗證

2. **建立 API 金鑰**

   - 登入後：Settings > API keys
   - 點選 Create new secret key
   - 複製金鑰（只會顯示一次，請妥善保存）

3. **設定環境變數**

   ```
   OPENAI_API_KEY=sk-xxxx...您的金鑰
   ```

### 5.3 本地 Whisper（替代方案，免金鑰）

- 使用 `openai-whisper` 在本機執行
- 不需 API 金鑰，但需較多 GPU/CPU 資源
- 專案建議：開發階段可先用本地 Whisper，省去金鑰與費用

### 5.4 參考文件

- Whisper API：https://platform.openai.com/docs/guides/speech-to-text
- 本地 Whisper：https://github.com/openai/whisper

---

## 6. 環境變數配置總覽

| 變數名稱 | 必填 | 取得來源 | 用途 |
|----------|------|----------|------|
| YOUTUBE_API_KEY | 是 | Google Cloud Console | 影片搜尋、metadata、字幕 |
| GOOGLE_MAPS_API_KEY | 是 | Google Cloud Console | 景點座標、路線、距離計算 |
| OPENAI_API_KEY | 否 | OpenAI Platform | 使用 Whisper API 時需要 |
| DATABASE_URL | 是 | 自建/雲端 DB | PostgreSQL 連線 |
| REDIS_URL | 是 | 自建/雲端 Redis | Session 與快取 |
| OLLAMA_BASE_URL | 否 | 本地 Docker | 預設 http://localhost:11434 |
| OLLAMA_MODEL | 否 | Ollama 模型名稱 | 預設 qwen3:8b |

---

## 7. 安全建議

1. **勿將金鑰提交至版本控制**

   - `.env` 應加入 `.gitignore`
   - 僅使用 `.env.example` 作為範本，不包含真實金鑰

2. **金鑰限制**

   - 在 Google Cloud 限制可呼叫的 API
   - 設定 IP 或網域限制，降低洩漏風險

3. **輪替金鑰**

   - 定期更換金鑰
   - 若懷疑外洩，立即撤銷並重新建立

---

## 8. 快速檢查清單

- [ ] 已建立 Google Cloud 專案
- [ ] 已啟用 YouTube Data API v3
- [ ] 已啟用 Places API、Directions API、Distance Matrix API
- [ ] 已建立並複製 Google API 金鑰
- [ ] （選用）已取得 OpenAI API 金鑰
- [ ] 已複製 `.env.example` 為 `.env` 並填入各金鑰
- [ ] 已確認 `.env` 在 `.gitignore` 中

---

## 9. 參考文件

- [系統需求規格書.md](./系統需求規格書.md) - 系統架構與 API 設計
- [技術實作指南.md](./技術實作指南.md) - 技術實作細節
