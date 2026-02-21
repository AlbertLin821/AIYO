# AIYO 愛遊 - 開發待辦

依 [開發路線圖.md](./開發路線圖.md) 與專案規格整理之整體待辦，供團隊追蹤進度。

**文件版本**：2.1  
**更新日期**：2026-02-21

---

## 參照文件版本

修訂本待辦時所依據的規格與路線圖版本如下。若下列文件有重大更新，請同步檢視本待辦並調整。

| 文件 | 版本 | 路徑 |
|------|------|------|
| 開發路線圖 | 1.0 | [開發路線圖.md](./開發路線圖.md) |
| 系統需求規格書 | 1.0 | [系統需求規格書.md](./系統需求規格書.md) |
| 使用者需求規格書 | - | [使用者需求規格書.md](./使用者需求規格書.md) |

---

## 階段零：API 金鑰配置與環境建置

完成所有 API 金鑰申請、環境變數設定與開發環境建置後，再進入階段一。

### API 金鑰與服務啟用

- [ ] Google Cloud 專案建立
- [ ] YouTube Data API v3 啟用並取得金鑰
- [ ] Google Maps：Places API、Directions API、Distance Matrix API 啟用
- [ ] Google Maps API 金鑰取得（可與 YouTube 共用或分開）
- [ ] （選用）OpenAI API 金鑰（若使用 Whisper API 而非本地 Whisper）

### API 配額與成本追蹤

依據：YouTube Data API 預設每日 10,000 units（Pacific Time 午夜重置）；search.list 每次 100 units。詳見 [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)。

- [ ] 在 Google Cloud Console 建立配額監控（Quotas 頁面）
- [ ] 確認 search.list 若 maxResults=50，每頁 100 units；索引 50 支影片約 100–200 units
- [ ] （建議）設定配額達 80% 時的提醒

### 環境變數配置

- [ ] 複製 `.env.example` 為 `.env`
- [ ] 填入 `YOUTUBE_API_KEY`
- [ ] 填入 `GOOGLE_MAPS_API_KEY`
- [ ] 填入 `DATABASE_URL`、`REDIS_URL`（或沿用 Docker 預設）
- [ ] 填入 `OLLAMA_BASE_URL`、`OLLAMA_MODEL`（或沿用預設）

### Docker 環境

- [x] 啟動 `docker compose up -d`
- [x] 確認 PostgreSQL、Redis、Ollama 正常運行
- [ ] 確認 Ollama 已下載所需模型（如 `qwen2.5:7b-instruct`、`qwen3:8b`）

### 開發環境建置

- [x] video-indexer：建立 `.venv`、`pip install -r requirements.txt`
- [ ] ai-service：建立 `.venv`、安裝依賴
- [x] frontend：專案已建立，`npm install` 完成
- [ ] api-gateway：`npm install`（專案建立後）

### 參考文件

- [API金鑰取得與配置指南.md](./API金鑰取得與配置指南.md)
- [虛擬環境與開發環境設定指南.md](./虛擬環境與開發環境設定指南.md)

---

## 階段一：影片索引原型（Week 1-2）

**資料儲存原則**：僅儲存影片 metadata、片段時間戳（start_sec、end_sec）、tag 內容（景點、類型等）、summary 與 embedding 向量。不儲存 YouTube 影片檔案或完整字幕原文。

**處理流程**：完整字幕僅用於**首次**處理影片時（段落摘要、語意分段、景點抽取）。處理完成後，不論同一使用者再次訪問或他使用者查詢同類型影片，皆直接從 DB 讀取已儲存的時間戳與段落摘要，不再重跑 Whisper 或重新分段，以節省時間與資源。

### 1. YouTube API 整合

- [x] 實作 `search.list` 搜尋影片（關鍵字：台灣旅遊、台南兩天一夜等；建議 maxResults=50 以節省配額）
- [x] 取得影片 metadata 並寫入 `videos` 表
- [x] 實作字幕取得：採用 **youtube-transcript-api**（無 OAuth、無配額）；無字幕時由 index_video 降級 Whisper
- [x] 若無字幕則標記為需 Whisper 處理（index_video.py 流程）
- [ ] （建議）實作錯誤處理與重試：對 429/5xx 使用 exponential backoff（如 tenacity、backoff），最多 3 次重試

### 2. Whisper 整合

- [x] 使用 yt-dlp 下載影片音訊
- [x] 使用 openai-whisper 轉文字並取得時間戳
- [x] 輸出格式：`[(start_time, end_time, text), ...]`（whisper_transcribe.py）
- [ ] （建議）實作逾時與失敗重試，避免單支影片失敗導致整批中斷

### 3. 字幕前處理

- [x] 整理字幕序列為統一格式（transcripts.py、index_video 使用）
- [ ] 整合 jieba 斷詞（選用）
- [x] 輸出供 Embedding 使用

### 4. Embedding 與語意分段

依據：paraphrase-multilingual-MiniLM-L12-v2 輸出維度 384；sentence-transformers 的 `encode()` 支援 `batch_size`，不同 batch_size 可能產生不同結果，應固定使用同一值。

- [x] 載入 sentence-transformers（paraphrase-multilingual-MiniLM-L12-v2）
- [x] 對字幕句子產生 embedding，使用 `encode(..., batch_size=32)` 固定（semantic_segment.py）
- [x] 處理完即釋放原文，不儲存
- [x] 實作語意分段演算法：cosine 相似度閾值 + 時間間隔規則（segment_by_semantic_similarity）
- [x] 產出片段：起訖時間、summary、tags（Segment 結構）

### 5. 景點實體抽取與 Tag 產出

- [ ] 字典/正則比對常見景點（選用，目前以 LLM 為主）
- [x] 呼叫 Ollama LLM 從片段字幕抽取景點與類型（JSON 格式）（extract_places.py）
- [x] 解析並去重景點列表
- [x] 產出片段 tags：景點名稱、類型（美食/親子/室內/室外等）

### 6. 資料寫入與索引

依據：`scripts/init-db.sql` 已建立 HNSW 向量索引；`scripts/migrations/001_initial_schema.sql` 已補上向量索引，與 init-db 一致。

- [x] 寫入 `videos`（search_youtube.py：youtube_id、title、channel 等）
- [x] 寫入 `segments`（index_video.py：時間戳、summary、tags、embedding_vector）
- [x] 寫入 `places`（index_video.py；lat/lng 可後續補 Google Maps）
- [x] 寫入 `segment_places` 關聯
- [x] 確認 DB 已建立 segments、places 的 HNSW 向量索引（init-db.sql）
- [ ] 驗證 pgvector 查詢可用（例：`ORDER BY embedding_vector <-> :q LIMIT 10`）（階段二 RAG 時實作）

### 7. Schema 與 Migration 一致性

- [x] 確認 `001_initial_schema.sql` 與 `init-db.sql` 內容一致（含向量索引）
- [x] 確認 `002_itineraries.sql` 已存在（itineraries、itinerary_days、itinerary_slots，供階段二使用）
- [x] `003_add_segments_tags.sql` 已新增（segments.tags JSONB）

### 8. 驗收

- [ ] 至少 50 支影片完成索引
- [ ] 片段切割準確率 > 70%（人工抽樣）
- [ ] 景點抽取準確率 > 60%（人工抽樣）

---

## 階段二：RAG + 對話後端（Week 3-4）

依據 `docs/系統需求規格書.md`：API Gateway（Node.js + Express）負責 session、itinerary CRUD；AI Service（Python + FastAPI）負責 RAG、LLM、Tool-calling。以下拆成兩塊服務。

### 2a. ai-service（Python + FastAPI）

#### 2a.1 專案架構

- [ ] 建立 ai-service 專案結構與 requirements.txt
- [ ] 實作 `POST /api/chat`（含 RAG、LLM、Tool-calling）
- [ ] 實作 `GET /api/videos`、`GET /api/videos/:id/segments`、`GET /api/segments/:id`
- [ ] 實作 `plan_itinerary` Tool：依 segments、days、preferences 產出行程 JSON，回傳給呼叫端
- [ ] 啟用 Swagger / OpenAPI 文件

#### 2a.2 Ollama 整合

依據：[Ollama Errors](https://docs.ollama.com/api/errors)、[Addressing Timeout Issues in Ollama](https://www.arsturn.com/blog/addressing-timeout-issues-in-ollama)。Ollama 無內建 retry，需在應用層實作。

- [ ] 連線 Ollama（base_url、model）
- [ ] 設定 `request_timeout`（建議 60 秒，大模型或慢速環境可加長）
- [ ] 實作 chat completions 呼叫
- [ ] 實作重試：對 429/5xx/連線失敗使用 exponential backoff（最多 3 次）
- [ ] 測試串流回應
- [ ] 驗證中文與 JSON 輸出

#### 2a.3 RAG 實作

- [ ] 使用與 video-indexer 相同 Embedding 模型（paraphrase-multilingual-MiniLM-L12-v2，384 維）
- [ ] Query 轉向量後在 pgvector 搜尋 segments（使用 HNSW 索引）
- [ ] 整合搜尋結果為 context 傳給 LLM
- [ ] 產生自然語言回覆

#### 2a.4 Tool-calling

- [ ] 定義 `search_segments`、`plan_itinerary` 工具 schema
- [ ] 實作 `search_segments`：依 query、city、limit 查 pgvector
- [ ] 實作 `plan_itinerary`：依 segments、days、preferences 產出行程 JSON
- [ ] 處理 tool call 回傳並二次呼叫 LLM 取得最終回覆

#### 2a.5 四大模組

- [ ] Tool-usage：解析與執行 tool call 邏輯
- [ ] Recommendation：依 RAG 結果排序與篩選
- [ ] Planning：呼叫 Google Maps（Directions、Distance Matrix）優化順序；建議實作重試與逾時
- [ ] Memory：Redis 儲存/讀取 session 最近 N 則訊息

### 2b. api-gateway（Node.js + Express）

- [ ] 建立 api-gateway 專案結構
- [ ] 實作 `GET /api/chat/history/:sessionId`、`DELETE /api/chat/history/:sessionId`（或委託 ai-service，依架構決定）
- [ ] 實作 `POST /api/itinerary`、`GET /api/itinerary/:id`、`PUT /api/itinerary/:id`、`DELETE /api/itinerary/:id`（寫入 itineraries 等表）
- [ ] 實作 WebSocket：`message`、`stream_response`、`itinerary_update`（轉發至 ai-service 或直連）
- [ ] 對接 ai-service（轉發 chat、RAG、行程規劃等請求）

### 2c. 驗收

測量定義：以下指標需有明確測量方式（何種請求、從哪個端點、採用平均/中位數/p95）。

- [ ] 所有 API 端點正常
- [ ] RAG 檢索相關度 > 70%（人工抽樣或與 golden set 比較）
- [ ] Tool-calling 成功率 > 80%
- [ ] 單次 chat 請求（含 1 次 RAG + 1 次 tool call）p95 回應時間 < 5 秒

---

## 階段三：前端 UI（Week 5-6）

### 1. Next.js 專案

- [x] 建立 frontend 專案（Next.js App Router）
- [x] 設定 Tailwind CSS
- [x] 設計路由：首頁、Chat 頁、行程頁（app/page.tsx 含 Chat 與行程規劃 UI）
- [ ] 設定 SSR/ISR（若有需要）
- [ ] shadcn/ui（選用）

### 2. 首頁

- [ ] 核心 Slogan 與簡短說明
- [ ] 「按住說話」主按鈕
- [ ] Demo 動畫或 GIF（選用）

### 3. Chat UI

- [x] 對話訊息列表元件
- [x] 輸入框（文字輸入）
- [x] 串流回應顯示（對接 Ollama API，SSE）
- [x] 快捷按鈕（如天數、親子景點等，依 page.tsx 實作）

### 4. 語音輸入

- [ ] 整合 Web Speech API
- [ ] 按住說話 UI 與狀態
- [ ] 語音轉文字顯示於輸入框
- [ ] 可編輯後再送出

### 5. 影片牆與片段卡片

- [ ] 影片牆布局（Reels 風格）
- [ ] YouTube Player API 整合
- [ ] 片段卡片：縮圖、標題、時長、Tag
- [ ] 點卡片跳轉影片時間
- [ ] 片段列表上下滑動（選用）

### 6. 地圖與行程視覺化

- [ ] Google Maps 元件
- [ ] 景點標記
- [ ] 路線顯示（Directions）
- [ ] 行程時間軸

### 7. 即時通訊

- [ ] WebSocket 或 Socket.io 客戶端
- [ ] 串流 AI 回應即時顯示
- [ ] 行程更新即時反映

### 8. 響應式設計

- [ ] Mobile First 版面
- [ ] 平板、桌面斷點
- [ ] 觸控與手勢（選用）

### 9. 驗收

- [ ] 語音輸入可用
- [ ] 影片播放與跳轉正常
- [ ] 地圖顯示正確
- [ ] 響應式完成

---

## 階段四：MVP 部署（Week 7）

### 1. 部署準備

依據：[pythonspeed.com - Decoupling migrations](https://pythonspeed.com/articles/schema-migrations-server-startup)：生產環境 migration 應在部署前單獨執行，不應隨應用啟動自動執行。

- [ ] 整理生產環境變數清單（含必填項檢查）
- [ ] 建立部署用 Dockerfile（可選）
- [ ] 確認 migration 腳本可重複執行（001、002 等使用 IF NOT EXISTS）
- [ ] 定義 migration 執行流程：部署前由 CI/CD 或手動執行，不隨應用啟動
- [ ] README 部署章節

### 2. 上線前檢查清單

- [ ] 所有敏感環境變數已設定且正確
- [ ] 資料庫 migration（001、002）已在目標環境執行完成
- [ ] pgvector 擴充已安裝，segments、places 的 HNSW 索引已建立
- [ ] 至少一次端對端測試：chat -> RAG -> 行程產出 -> 儲存

### 3. 前端部署

- [ ] Vercel 或 Railway 建立專案
- [ ] 環境變數設定
- [ ] 自訂域名與 SSL

### 4. 後端部署

- [ ] Railway / Render 部署 ai-service（FastAPI）
- [ ] （若採用）部署 api-gateway（Node.js + Express）
- [ ] 設定 DATABASE_URL、REDIS_URL
- [ ] 設定 OLLAMA_BASE_URL（若分開部署需調整）

### 5. 資料庫與 Redis

- [ ] Supabase 建立 PostgreSQL 專案
- [ ] 安裝 pgvector 擴充
- [ ] 執行 migration 001、002
- [ ] 確認向量索引已建立
- [ ] Upstash Redis 或自架，設定 REDIS_URL

### 6. 測試與監控

依據：上線前即需基本可觀測性，不應延後到階段五。

- [ ] 功能測試清單
- [ ] 效能測試（定義測量情境：如 chat p95 < 5 秒、行程規劃 < 10 秒）
- [ ] 至少 5 位內部使用者測試
- [ ] 錯誤監控（必選）：錯誤率、主要 API 延遲；可使用 Railway/Render 內建或第三方服務

---

## 階段五：後續優化（Scale）

### 1. 效能優化

- [ ] 模型量化（q5_k_m 等）
- [ ] Redis 快取常用查詢
- [ ] Embedding 批次處理（已於階段一採用 batch_size，此處可調優）
- [ ] 資料庫查詢優化

### 2. 擴展（若有流量）

- [ ] K8s 集群建立
- [ ] vLLM 部署與 HPA
- [ ] 負載平衡設定

### 3. 監控與維運

- [ ] Prometheus + Grafana
- [ ] 日誌聚合
- [ ] 告警規則

---

## 已備妥基礎（階段零前置）

以下項目已由專案設定完成，無須重複建置：

- Docker Compose 設定（PostgreSQL、Redis、Ollama），Ollama 已啟用 NVIDIA GPU（deploy.resources.reservations.devices）
- 資料庫 Schema（videos、segments、places、segment_places、itineraries 等）與 init-db.sql
- Migration 腳本（001_initial_schema.sql、002_itineraries.sql、003_add_segments_tags.sql）
- 專案目錄結構（frontend、video-indexer、scripts、docs）
- .env.example、API 金鑰取得指南、虛擬環境指南
