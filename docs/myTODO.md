# AIYO 愛遊 - 開發待辦

依 [開發路線圖.md](./開發路線圖.md) 與專案規格整理之整體待辦，供團隊追蹤進度。

**文件版本**：3.0  
**更新日期**：2026-02-28

---

## 參照文件版本

修訂本待辦時所依據的規格與路線圖版本如下。若下列文件有重大更新，請同步檢視本待辦並調整。

| 文件 | 版本 | 路徑 |
|------|------|------|
| 開發路線圖 | 1.0 | [開發路線圖.md](./開發路線圖.md) |
| 系統需求規格書 | 1.0 | [系統需求規格書.md](./系統需求規格書.md) |
| 使用者需求規格書 | - | [使用者需求規格書.md](./使用者需求規格書.md) |
| 8 週個人化優先規劃 | 1.0 | .cursor/plans/aiyo-8週個人化優先規劃_e09871ef.plan.md |

---

## 階段零：API 金鑰配置與環境建置

完成所有 API 金鑰申請、環境變數設定與開發環境建置後，再進入階段一。

### API 金鑰與服務啟用

- [x] Google Cloud 專案建立
- [x] YouTube Data API v3 啟用並取得金鑰
- [x] Google Maps：Places API、Directions API、Distance Matrix API 啟用
- [x] Google Maps API 金鑰取得（可與 YouTube 共用或分開）
- [x] （選用）OpenAI API 金鑰（若使用 Whisper API 而非本地 Whisper）

### API 配額與成本追蹤

依據：YouTube Data API 預設每日 10,000 units（Pacific Time 午夜重置）；search.list 每次 100 units。詳見 [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)。

- [x] 在 Google Cloud Console 建立配額監控（Quotas 頁面）
- [x] 確認 search.list 若 maxResults=50，每頁 100 units；索引 50 支影片約 100-200 units
- [x] （建議）設定配額達 80% 時的提醒

### 環境變數配置

- [x] 複製 `.env.example` 為 `.env`
- [x] 填入 `YOUTUBE_API_KEY`
- [x] 填入 `GOOGLE_MAPS_API_KEY`
- [x] 填入 `DATABASE_URL`、`REDIS_URL`（或沿用 Docker 預設）
- [x] 填入 `OLLAMA_BASE_URL`、`OLLAMA_MODEL`（或沿用預設）

### Docker 環境

- [x] 啟動 `docker compose up -d`
- [x] 確認 PostgreSQL、Redis、Ollama 正常運行
- [ ] 確認 Ollama 已下載所需模型（如 `qwen2.5:7b-instruct`、`qwen3:8b`）

### 開發環境建置

- [x] video-indexer：建立 `.venv`、`pip install -r requirements.txt`
- [x] ai-service：建立 `.venv`、安裝依賴
- [x] frontend：專案已建立，`npm install` 完成
- [x] api-gateway：`npm install` 完成

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

- [x] 建立 ai-service 專案結構與 requirements.txt
- [x] 實作 `POST /api/chat`（已支援 LLM 串流；RAG/Tool-calling 已串接）
- [x] 實作 `GET /api/videos`、`GET /api/videos/:id/segments`、`GET /api/segments/:id`
- [x] 實作 `plan_itinerary` Tool：已升級為約束感知版 v2（預算/節奏/交通/必去/避開）
- [x] 啟用 Swagger / OpenAPI 文件（FastAPI `/docs`）

#### 2a.2 Ollama 整合

- [x] 連線 Ollama（base_url、model，見 main.py OLLAMA_BASE_URL/OLLAMA_MODEL）
- [x] 設定 `request_timeout`（httpx.Timeout 90 秒）
- [x] 實作 chat completions 呼叫（/api/chat 完整串流）
- [x] 實作重試：工具呼叫已加入 `_execute_with_retry()`，最多 2 次重試含指數退避
- [x] 測試串流回應（SSE event stream 已驗證）
- [x] 驗證中文與 JSON 輸出（偏好抽取使用 format: json）

#### 2a.3 RAG 實作

- [x] 使用 Ollama embed API（nomic-embed-text）做查詢向量化
- [x] Query 轉向量後在 pgvector 搜尋 segments（使用 HNSW 索引；`/api/tools/search-segments`）
- [x] 整合搜尋結果為 context 傳給 LLM（`/api/chat` 已串接 RAG）
- [x] 產生自然語言回覆（基於 RAG context + Ollama）

#### 2a.4 Tool-calling

- [x] 定義工具 schema：get_current_time、get_weather、search_youtube_videos、search_travel_information、search_transport_options（agent.py get_tool_schemas）
- [x] 實作 `search_segments`：依 query、city、limit 查 pgvector（含文字降級）
- [x] 實作 `plan_itinerary`：升級為 v2 約束引擎（planner.py）
- [x] 處理 tool call 回傳並二次呼叫 LLM 取得最終回覆（resolve_tool_context 多輪迴圈）
- [x] 天氣查詢保底機制：模型未呼叫工具時自動強制查詢（should_force_weather_tool）
- [x] 工具參數地點讀取：支援 location/city/region/place/area 及巢狀物件

#### 2a.5 四大模組

- [x] Tool-usage：完整工具呼叫執行迴圈 + 重試（agent.py resolve_tool_context + _execute_with_retry）
- [x] Recommendation：統一重排引擎 v1（reranker.py），含城市/關鍵字/預算/節奏/約束/新鮮度計分 + 推薦理由
- [x] Planning：約束引擎 v2（planner.py），含 Haversine 距離/交通時間估算/預算檢查/時段衝突/必去/避開
- [x] Memory：Redis 儲存/讀取 session 最近 N 則訊息（api-gateway，失效時回退記憶體）

#### 2a.6 個人化特徵層（新增）

- [x] 統一個人化模組 `personalization.py`：UserFeatures dataclass 整合 user_profiles + user_memories + user_preferences + user_ai_settings
- [x] `merge_user_features()` 合併四張表為統一特徵介面
- [x] `features_to_keywords()` / `features_to_scoring_context()` / `features_to_system_context()` 供推薦、規劃、對話共用
- [x] `build_user_features()` 在 main.py 可一次取得完整使用者特徵

### 2b. api-gateway（Node.js + Express）

- [x] 建立 api-gateway 專案結構
- [x] 實作 `GET /api/chat/history/:sessionId`、`DELETE /api/chat/history/:sessionId`（Redis 優先，失效回退記憶體）
- [x] 實作 `POST /api/itinerary`、`GET /api/itinerary/:id`、`PUT /api/itinerary/:id`、`DELETE /api/itinerary/:id`（寫入 itineraries 等表）
- [x] 實作 WebSocket：`message`、`stream_response`、`itinerary_update`（基礎通道：`/ws`）
- [x] 對接 ai-service（chat 轉發、search-segments 轉發）
- [x] chat history 正式改為 DB（`chat_sessions`、`chat_messages`），Redis 保留快取用途
- [x] 推薦事件追蹤 API：`POST /api/recommendation/event`、`GET /api/recommendation/metrics`
- [x] 品質儀表板 API：`GET /api/dev/quality-dashboard`

### 2c. 帳號、主畫面與個人化（MVP）

- [x] 建立 `users`、`user_profiles`、`user_memories`、`chat_sessions`、`chat_messages` schema
- [x] 實作 Email/密碼註冊與登入（JWT）
- [x] 前端新增登入頁與主畫面，未登入導向登入頁
- [x] 將 chat/history/itinerary 與 `user_id` 關聯（保留 session 相容）
- [x] 新對話與新安排行程前載入使用者偏好與記憶（skill-like）
- [x] 個人化 API：`GET/PUT /api/user/profile`、`GET /api/user/memory`
- [x] AI 設定 API：`GET/PUT /api/user/ai-settings`、`PUT /api/user/location`（含經緯度、當前地區）

### 2d. AI 對話影片推薦（MVP）

- [x] `POST /api/chat` 回傳推薦影片（最多 5 支，含縮圖、摘要、時間戳）
- [x] 前端對話區顯示推薦卡片（含推薦理由與片段跳轉連結）
- [x] 點擊影片可開啟小型播放器
- [x] 點擊時間戳可跳轉影片片段（前端片段標籤連結到 YouTube ?t= 時間點）
- [x] 推薦結果帶有推薦理由（recommendation_reasons）
- [x] 推薦排序使用重排引擎（reranker.py：城市/關鍵字/預算/節奏/約束/新鮮度/來源）
- [x] 推薦事件追蹤（impression / click / segment_jump）

### 2e. 效能與重複處理優化

- [x] 已處理影片可直接由 DB 命中（不重跑分段與抽取）
- [x] 影片索引流程加入去重鍵（youtube_id + 版本）
- [x] Redis 快取熱門 query 與使用者 context
- [x] 明確驗證：不儲存整部影片與完整字幕原文

### 2f. 驗收

測量定義：以下指標需有明確測量方式（何種請求、從哪個端點、採用平均/中位數/p95）。

- [ ] 所有 API 端點正常（需逐一煙霧測試）
- [ ] RAG 檢索相關度 > 70%（人工抽樣或與 golden set 比較）
- [ ] Tool-calling 成功率 > 80%（可透過 quality-dashboard 查看）
- [ ] 單次 chat 請求（含 1 次 RAG + 1 次 tool call）p95 回應時間 < 5 秒（可透過 locustfile.py 壓測）

---

## 階段三：前端 UI（Week 5-6）

### 1. Next.js 專案

- [x] 建立 frontend 專案（Next.js App Router）
- [x] 設定 Tailwind CSS
- [x] 設計路由：首頁、Chat 頁、行程頁（app/page.tsx 含 Chat 與行程規劃 UI）
- [x] 設定 SSR/ISR（若有需要）（`frontend/app/home/page.tsx` 設定 `revalidate = 300`）
- [x] shadcn/ui（選用）（已導入基礎 `Button` 元件與 utility）

### 2. 首頁

- [x] 核心 Slogan 與簡短說明（`frontend/app/page.tsx` 首屏導語）
- [x] 「按住說話」主按鈕（首屏 CTA 與聊天區語音按鈕）
- [x] Demo 動畫或 GIF（選用）（首屏語音波形動畫）

### 3. Chat UI

- [x] 對話訊息列表元件
- [x] 輸入框（文字輸入）
- [x] 串流回應顯示（對接 Ollama API，SSE）
- [x] 快捷按鈕（如天數、親子景點等，依 page.tsx 實作）
- [x] 工具使用摘要顯示（tool_calls_summary）

### 4. 語音輸入

- [x] 整合 Web Speech API
- [x] 按住說話 UI 與狀態
- [x] 語音轉文字顯示於輸入框
- [x] 可編輯後再送出

### 5. 影片推薦與片段卡片

- [x] 推薦影片卡片（含縮圖、標題、城市標籤、來源標籤）
- [x] 片段時間戳跳轉連結（藍色標籤，連結到 YouTube ?t= 時間點）
- [x] 「為何推薦」區塊（綠色區塊，列出 recommendation_reasons）
- [x] 點擊推薦卡片開啟播放器
- [x] 影片牆布局（Reels 風格）（推薦卡改為橫向 snap 卡片流）
- [x] YouTube Player API 嵌入式播放（目前為外連）（已使用嵌入式 iframe 播放與片段跳轉）
- [x] 片段列表上下滑動（選用）（卡片內片段清單可垂直捲動）

### 6. 地圖與行程視覺化

- [x] Google Maps 元件（已整合）
- [x] 景點標記（搜尋結果標記）
- [x] 路線顯示（Directions API 整合）（`frontend/app/page.tsx`：依當日景點繪製 Google Directions 路線）
- [x] 行程時間軸視覺化（`frontend/app/page.tsx`：顯示到達/離開時間與前段交通資訊）

### 7. 行程規劃 UI

- [x] 多日行程管理（DayPlan 切換、新增、刪除、拖曳排序）
- [x] 行程編輯（景點拖曳排序、移至其他天）
- [x] 待安排清單
- [x] 儲存行程到伺服器（saveItineraryToServer）
- [x] 載入已儲存行程（從 API 讀取）（`GET /api/itinerary`、`GET /api/itinerary/:id` + 前端載入流程）
- [x] 行程匯出（PDF / 圖片 / 分享連結）（`frontend/app/page.tsx`：匯出 PDF、PNG、複製分享連結）

### 8. 即時通訊

- [x] WebSocket 客戶端（含 token 認證）
- [x] 串流 AI 回應即時顯示
- [x] 行程更新即時反映（itinerary_update 事件）

### 9. 響應式設計

- [x] Mobile First 版面（主版面改為 mobile-first 單欄，桌面再分欄）
- [x] 平板、桌面斷點（`xl` 雙欄、`md` 內容調整）
- [x] 觸控與手勢（選用）（行程區支援左右滑動切換 Day）

### 10. 驗收

- [x] 語音輸入可用
- [x] 影片播放與跳轉正常（嵌入式播放器待完成）
- [x] 地圖顯示正確
- [x] 響應式完成

---

## 階段四：MVP 部署（Week 7）

### 1. 部署準備

依據：[pythonspeed.com - Decoupling migrations](https://pythonspeed.com/articles/schema-migrations-server-startup)：生產環境 migration 應在部署前單獨執行，不應隨應用啟動自動執行。

- [x] 整理生產環境變數清單（含必填項檢查）（`scripts/deploy/validate_env.mjs`）
- [x] 建立部署用 Dockerfile（可選）（`ai-service/`、`api-gateway/`、`frontend/`）
- [x] 確認 migration 腳本可重複執行（001-011 使用 IF NOT EXISTS）
- [x] 定義 migration 執行流程：部署前由 CI/CD 或手動執行，不隨應用啟動（`api-gateway/scripts/run_migrations.js` + `migrate:*` scripts）
- [x] README 部署章節（`README.md`、`api-gateway/README.md`、`ai-service/README.md`）

### 2. 上線前檢查清單

- [ ] 所有敏感環境變數已設定且正確
- [ ] 資料庫 migration（001-011）已在目標環境執行完成
- [ ] pgvector 擴充已安裝，segments、places 的 HNSW 索引已建立
- [ ] 至少一次端對端測試：chat -> RAG -> tool call -> 行程產出 -> 儲存
- [ ] 推薦事件追蹤表已建立（migration 011）

### 3. 前端部署

- [ ] Vercel 或 Railway 建立專案
- [ ] 環境變數設定
- [ ] 自訂域名與 SSL

### 4. 後端部署

- [ ] Railway / Render 部署 ai-service（FastAPI）
- [ ] 部署 api-gateway（Node.js + Express）
- [ ] 設定 DATABASE_URL、REDIS_URL
- [ ] 設定 OLLAMA_BASE_URL（若分開部署需調整）

### 5. 資料庫與 Redis

- [ ] Supabase 建立 PostgreSQL 專案
- [ ] 安裝 pgvector 擴充
- [ ] 執行 migration 001-011
- [ ] 確認向量索引已建立
- [ ] Upstash Redis 或自架，設定 REDIS_URL

### 6. 測試與監控

- [x] 壓測腳本已建立（benchmark/locustfile.py，含 chat/weather/search/recommendation/health 場景）
- [ ] 執行壓測並確認 p95 達標
- [ ] 至少 5 位內部使用者測試
- [x] 錯誤監控已整合：Sentry（ai-service）、Prometheus /metrics（api-gateway + ai-service）
- [x] 審計日誌已建立（developer_audit_logs）
- [x] 品質儀表板已建立（/api/dev/quality-dashboard）

---

## 階段五：個人化深化與體驗優化（Week 7-8，對齊 8 週計畫）

### 1. 個人化閉環強化

- [x] 推薦事件追蹤資料表（migration 011: recommendation_events）
- [x] 推薦事件 API（POST /api/recommendation/event）
- [x] 推薦指標查詢 API（GET /api/recommendation/metrics）
- [x] 品質基線資料表（migration 011: quality_baselines）
- [x] 建立離線評估集（至少含：天氣問答、城市推薦、行程偏好 golden set）（`benchmark/offline_golden_set.json`）
- [x] 首次品質基線量測並記錄（`api-gateway/scripts/run_offline_baseline.js`；報告：`benchmark/reports/offline-baseline-2026-02-28T07-33-12-073Z.json`）
- [x] 推薦 CTR 追蹤與逐週比較（`GET /api/recommendation/ctr-weekly`、`GET /api/dev/recommendation/ctr-weekly`、weekly baseline 寫入 `quality_baselines`）

### 2. 推薦引擎持續優化

- [x] 統一重排引擎 v1（reranker.py）
- [x] 推薦解釋性：recommendation_reasons + score_breakdown
- [x] 整合 YouTube 即時搜尋結果到候選池（build_candidates_from_youtube_api 已建立，已在 get_recommended_videos 串接）
- [x] 依使用者歷史點擊調整推薦權重（利用 recommendation_events；已在 get_recommended_videos + reranker 加入 behavior_feedback）
- [x] 定期重算推薦基線指標（`api-gateway/scripts/recompute_recommendation_baselines.js`，輸出寫入 `quality_baselines`）

### 3. 行程規劃深度化

- [x] 約束引擎 v2（planner.py）：預算/節奏/交通/必去/避開/時段檢查
- [x] Haversine 距離計算 + 交通時間估算
- [x] 串接 Google Maps Directions API 取得真實交通時間（`planner.py`：`fetch_google_directions_minutes`，失敗自動回退估算）
- [x] 行程可行性報告前端視覺化（顯示 warnings 與 feasible 標記）（`frontend/app/page.tsx`）
- [x] 行程重新優化功能（使用者調整後重新計算）（`POST /api/itinerary/reoptimize` + 前端「重新優化/套用優化排序」）

### 4. 體驗流暢度

- [x] 工具呼叫重試機制（_execute_with_retry，最多 2 次）
- [x] 天氣查詢保底機制（模型未呼叫工具時自動補查）
- [x] 前端送出聊天時附帶 city 保底
- [ ] chat 核心路徑 p95 < 5 秒（需實測確認）
- [ ] 工具失敗時降級回覆文案優化
- [ ] 串流回應首 token 時間優化

---

## 階段六：後續擴展（Scale）

### 1. 效能優化

- [ ] 模型量化（q5_k_m 等）
- [x] Redis 快取常用查詢
- [ ] Embedding 批次處理調優
- [ ] 資料庫查詢優化（慢查詢分析）

### 2. 擴展（若有流量）

- [ ] K8s 集群建立
- [ ] vLLM 部署與 HPA
- [ ] 負載平衡設定

### 3. 監控與維運

- [x] Prometheus /metrics 端點（api-gateway + ai-service）
- [x] Sentry 錯誤追蹤（ai-service）
- [x] 審計日誌（developer_audit_logs + developer_login_events）
- [x] 開發者後台（/dev/dashboard）
- [ ] Grafana 視覺化儀表板
- [ ] 日誌聚合（ELK / Loki）
- [ ] 告警規則

---

## 已備妥基礎（階段零前置）

以下項目已由專案設定完成，無須重複建置：

- Docker Compose 設定（PostgreSQL、Redis、Ollama），Ollama 已啟用 NVIDIA GPU（deploy.resources.reservations.devices）
- 資料庫 Schema（videos、segments、places、segment_places、itineraries 等）與 init-db.sql
- Migration 腳本（001-011），涵蓋：初始 schema、行程表、tags、使用者帳號、記憶、偏好向量、AI 設定與位置、審計日誌、推薦事件追蹤
- 專案目錄結構（frontend、api-gateway、ai-service、video-indexer、scripts、docs、benchmark）
- .env.example、API 金鑰取得指南、虛擬環境指南
- 個人化模組（personalization.py）、推薦重排引擎（reranker.py）、行程約束引擎（planner.py）
- 工具呼叫系統（agent.py）：天氣/YouTube/交通/旅遊資訊/時間查詢 + 重試 + 保底機制
- 單元測試 28 個通過（test_tools、test_personalization、test_reranker、test_planner）

---

## 目前開發狀態總覽（2026-02-28）

| 模組 | 狀態 | 備註 |
|------|------|------|
| 影片索引 (video-indexer) | 基礎完成 | 缺少自動化排程、需手動執行 |
| AI 服務 (ai-service) | 核心完成 | chat/RAG/tool-calling/推薦/規劃/個人化皆已實作 |
| API 閘道 (api-gateway) | 核心完成 | 認證/chat/itinerary/記憶/AI設定/事件追蹤/dev console |
| 前端 (frontend) | 核心完成 | chat/行程/地圖/推薦卡片/語音/片段跳轉皆已有 |
| 資料庫 | 已備妥 | migration 001-011，含 pgvector/HNSW |
| 監控與品質 | 基礎完成 | Prometheus/Sentry/audit/quality-dashboard/壓測腳本 |
| 部署 | 尚未開始 | Docker 可本地運行，生產部署待進行 |

### 下一步優先事項

1. 執行 migration 011 並驗證推薦事件追蹤
2. 建立離線品質評估集並做首次基線量測
3. 串接 YouTube 即時搜尋結果到推薦候選池
4. 前端行程可行性報告視覺化
5. 端對端煙霧測試 + 壓測確認 p95
6. 進入部署準備
