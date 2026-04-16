# AIYO 語音＋地球地圖＋YouTube 景點標記功能技術規劃

## 一、概觀與可行性

AIYO 想要的體驗是：在網頁上看到一個地球／地圖畫面，按下發話按鈕說出「我想去哪裡」，系統即時聽懂目的地，幫你找出相關旅遊影片，將影片中出現的景點標在地圖上，並進一步幫你排成旅遊行程。這在現有 Web 技術與你已有的 React + FastAPI + PostgreSQL + pgvector + Ollama 架構下是可行的，只是需要把「語音輸入」「影片→地點→行程」拆成幾個明確模組來實作。[^1]

開源地圖與地球視圖如 CesiumJS（3D 地球）與 MapLibre GL JS（向量地圖）已經被廣泛用於 Web 上展示互動地圖與全球視圖，且有現成 React 範例可用。瀏覽器端的 Web Speech API 則可以直接在前端做語音辨識，把語音轉成文字後再送給後端的 Ollama 模型處理意圖與規劃。同時，已有專案展示「把 YouTube 旅遊影片放到地圖上」與「從影片字幕中抽出地點並在地圖上標記」的想法，證明 YouTube→地點→地圖 的流程是行得通的。[^2][^3][^4][^5][^6][^7][^8][^9][^10]

因此，技術關鍵不在於「能不能做到」，而在於如何設計一套適合 AIYO 的資料流程與 MVP 範圍，讓重的工作（影片分析、字幕處理）盡量離線批次完成，線上互動只做查詢與排程組合，才能在本地 Ollama 模型下維持良好效能。

## 二、開源元件與參考專案

這一節整理你可以直接拿來用或借鏡的開源元件與 GitHub 專案，方便之後深入研究。

### 1. 地圖／地球視圖

- **CesiumJS**：開源 JavaScript 函式庫，專門做高精度的 3D 地球與地圖視覺化，支援 WGS84 地球、3D Tiles、大規模地理資料可視化，很適合做「地球視圖」與航線、攝影機動畫等效果。[^2]
- **MapLibre GL JS**：Mapbox GL JS 的開源分支，以 TypeScript 撰寫，提供 GPU 加速的向量地圖渲染，可搭配 OSM、MapTiler 等圖磚來源，完全開源社群維護。[^5][^11]
- **React 整合樣板**：`maptiler/get-started-react-maplibre-gl-js` 提供 MapLibre GL JS + React 的起手式專案，內建基本地圖載入、標記、互動事件，適合直接 fork 當作 AIYO 的地圖前端骨架。

### 2. 瀏覽器語音輸入

- **Web Speech API**：提供 `SpeechRecognition`（語音轉文字）與 `SpeechSynthesis`（文字轉語音）兩大功能，可在 Chrome 等瀏覽器直接啟用麥克風，將語音即時轉成文字顯示在畫面上。[^3][^6][^7]
- Chrome 官方與 MDN 文件都有範例示範如何檢查 `webkitSpeechRecognition` 是否存在、啟動連續辨識、處理辨識結果與錯誤等，前端只要把結果文字送到你的 FastAPI 後端即可。[^9][^3]

### 3. 影片→地點→地圖 的參考實作

- **vOtpuskSam.ru（AI YouTube 旅遊影片地圖）**：這個專案會自動追蹤 YouTube 旅遊頻道的新影片，使用 NLP 與命名實體辨識（NER）從影片描述中抽出地點，轉成座標後顯示在互動地圖上。可以作為「如何大量抓取旅遊影片→抽地點→放地圖」的概念參考。[^4]
- **Apify: Youtube to Travel**：這個 Apify Actor 支援貼上任意帶字幕的 YouTube 影片網址，系統會分析標題與字幕，偵測國家或城市，並將影片中提到的關鍵地點標在地圖上。它的流程幾乎就是你要做的：影片→字幕→地點偵測→地圖標記。[^10]
- **CV-to-Maps（sasha-kap/CV-to-Maps）**：研究型專案，針對旅遊影片做物件偵測與 OpenStreetMap（OSM）比對，嘗試將視覺物件與地理資料結合來評估地點。雖然主要是學術實驗，但設計上展示了「影片內容→OSM 地理物件→空間分析」的玩法。[^12]
- **Travel_Creator_Map / youtubeproject 等 GitHub 專案**：有專案實作「從 YouTube 旅遊影片中擷取 POI 並在地圖上顯示」以及「搜尋 geo-tagged YouTube 旅遊影片並在地圖上釘選」的 web app，可參考其使用 YouTube API、地圖庫與資料結構方式。

### 4. 語音助理／即時對話 UI 參考

- **OpenAI Realtime WebRTC 範例**：目前有多個開源專案示範如何用 WebRTC + Realtime API 做即時語音助理，例如 `realtime-webrtc` 等，展示了前端如何管理麥克風、雙向串流與語音 UI 效果。雖然你目前以本地 Ollama 為主，未必需要 WebRTC，但可以借用其 UI/UX 設計，例如按鈕狀態、波形動畫、語音中斷邏輯等。[^13]

## 三、整合步驟：YouTube → 片段擷取流程

這一節專注在「從 YouTube 影片，到取得標記時間點的景點片段」的完整技術流程，目標是讓 AIYO 能夠：

1. 針對某個目的地（例如東京）搜尋一批高品質 YouTube 旅遊影片。
2. 自動取得字幕或轉寫，切成帶時間範圍的文字片段。
3. 用 Ollama 模型對片段做地點實體辨識與景點分類，變成結構化資料。
4. 對地點做地理編碼（lat/lng），存入 PostgreSQL + pgvector 方便快速查詢。
5. 前端可以根據使用者選定的目的地與偏好，查詢相關片段並顯示在地圖與行程中。

### 步驟 1：影片收集與基本資料儲存

1. 透過 YouTube Data API v3 的 `search.list` 依照關鍵字（如「Tokyo travel vlog」「台北 旅遊 景點」）搜尋影片，篩選出觀看數與長度符合門檻的清單。[^14]
2. 使用 `videos.list` 取得每支影片的 `snippet`、`statistics`、`contentDetails`，包括標題、說明、頻道、觀看數、讚數、長度等欄位。[^14]
3. 在 PostgreSQL 建立 `videos` 資料表，欄位可以包含：
   - `id`（內部主鍵）、`youtube_id`、`title`、`description`、`channel_title`
   - `view_count`、`like_count`、`duration_seconds`
   - `language`、`main_location`（之後填）、`created_at`、`updated_at`
4. 可先限定少數城市（例如：台北、東京、大阪），以便在 MVP 階段控制資料量與 API 成本。[^10]

### 步驟 2：字幕取得與語音轉文字

1. 若影片已提供字幕：
   - 使用 YouTube Captions API 取得字幕檔（通常為 WebVTT/TTML），裡面包含時間戳與文字內容。[^10]
   - 將字幕轉成標準化格式，如 `[{ start: seconds, end: seconds, text: string }]`。
2. 若影片沒有字幕：
   - 透過後端批次工作（celery / RQ / FastAPI BackgroundTasks）搭配 `yt-dlp` 下載影片音軌。
   - 使用本地或伺服器上的 Whisper 模型做語音轉文字，產生帶時間戳的 transcript（你現有的語音系統經驗可以直接沿用）。[^15]
3. 建立 `subtitles` 或 `video_segments_raw` 表，存每一小段 transcript：
   - `video_id`、`start_sec`、`end_sec`、`text`、`language`。

### 步驟 3：文字切片與語意段落分群

字幕通常是以數秒一句的細碎段落，直接拿來做景點推薦會太雜亂。建議做一層語意段落分群：

1. 以固定時間窗（例如 20–40 秒）或字元數（例如 300–500 字）做滑動視窗，將多筆字幕合併成一個「段落」，每段保留 `start_sec` 與 `end_sec` 範圍。
2. 將每一段文字記錄在 `video_segments` 表：
   - `id`、`video_id`、`start_sec`、`end_sec`、`text_merged`、`language`。
3. 之後所有 NER、embedding、景點標記都針對這個 `video_segments` 層級操作，以降低模型負擔與提升語意完整度。

### 步驟 4：地點實體與景點資訊抽取（Ollama NER）

1. 參考 vOtpuskSam 與 Apify Youtube to Travel 的做法，對每個 `video_segment` 使用 NER 模型抽取地點實體（城市、景點、建築、交通節點）。[^4][^10]
2. 你可以在 Ollama 中配置一個較小的中文友善模型（例如 qwen2.5 系列）專門負責「地點與景點 JSON 抽取」，Prompt 類似：
   ```
   你是一個旅遊影片地點抽取助手。
   給定一段旅遊影片字幕，請在 JSON 中列出所有提到的具體景點或地理位置。
   ...（略，包含輸出格式說明）
   ```
3. 對每段 `text_merged` 呼叫 Ollama `/api/chat`，取得類似：
   ```json
   {
     "places": [
       {"name": "淺草寺", "type": "temple", "city": "東京", "country": "日本"},
       {"name": "雷門", "type": "landmark", "city": "東京", "country": "日本"}
     ]
   }
   ```
4. 將結果存入 `segment_places` 表：
   - `segment_id`、`place_name`、`place_type`、`city`、`country`、`raw_json`。
5. 若要更進階，也可以參考 CV-to-Maps 把畫面中的視覺物件配合 OSM 進一步確認地點，但 MVP 階段先以字幕文字為主即可。[^12]

### 步驟 5：地理編碼（Geocoding）與座標存儲

1. 使用 Geocoding API（如 Google Maps Geocoding / Places API，或開源 Nominatim 與 Photon）將 `place_name + city + country` 轉成 `lat`、`lng` 與 `place_id` 等資訊。[^16][^8]
2. 更新 `segment_places` 表新增欄位：
   - `lat`、`lng`、`place_id`、`address` 等。
3. 如果一個 segment 出現多個地點，可拆成多列並分別儲存，前端可選擇以「主要景點」或「全部景點」來顯示標記。

### 步驟 6：Embedding 與向量索引（支援偏好與語意搜尋）

1. 使用現有的 `nomic-embed-text` 模型為每段 `video_segment.text_merged` 生成 768 維 embedding，存入 `video_segment_embeddings`，並在 PostgreSQL 上建立 pgvector 索引。[^17]
2. 這讓你可以根據使用者旅遊偏好（例如喜歡「美食」「夜景」「親子」）把偏好文字轉 embedding，搜尋語意相似的影片段落，做到「加上個人化濾鏡的片段推薦」。[^1][^14]

### 步驟 7：線上查詢與前端整合流程

使用者對 AIYO 說「我想去東京玩三天」時，線上查詢流程可設計為：

1. 前端語音辨識完畢，把文字（例如「我想去東京玩三天，大概預算三萬台幣」）送到 `/api/plan_trip_voice`。
2. 後端先用一個輕量 LLM（Ollama）解析出目的地（東京）、天數（3 天）、預算（約三萬）與偏好關鍵字（若有）。[^1]
3. 依目的地（東京）＋偏好 embedding 向量，在 `video_segment_embeddings` + `segment_places` 查詢：
   - 地點位於東京周邊的 segment。
   - 與偏好語意接近的 segment。
4. 挑選前 N 支影片（例如最多 5 支），每支影片選出幾個代表性的 segment 作為「時間軸上可點擊的重點片段」，回傳給前端：
   ```json
   [
     {
       "youtubeId": "...",
       "title": "東京三日自由行攻略",
       "channelTitle": "XXX Travel",
       "viewCount": 123456,
       "likeCount": 7890,
       "segments": [
         {
           "startSec": 120,
           "endSec": 180,
           "summary": "淺草寺與雷門散步",
           "places": [ { "name": "淺草寺", "lat": ..., "lng": ... } ]
         },
         ...
       ]
     }
   ]
   ```
5. 前端以這個結構渲染五個小型播放器，並在地圖上標出 `places` 對應的標記，同時顯示簡短摘要與可點擊的時間戳記。

## 四、技術落地：Ollama 本地推理流程（文字版流程圖）

以下是一個以「前端語音輸入＋本地 Ollama 推理＋後端 API」為主的流程圖，用文字階層方式描述。

### 1. 模型與服務角色分工

- **Ollama 模型群**：
  - 對話／規劃模型：例如 `llama3.1`，負責理解使用者意圖、設計行程草案、產生自然語言說明。
  - NER／地點抽取模型：例如 `qwen2.5` or 其他小模型，專門用於從字幕或使用者輸入中抽出地點與景點實體。[^4][^10]
  - Embedding 模型：`nomic-embed-text`，用於影片段落、景點描述與使用者偏好的語意向量表示，搭配 pgvector。[^17]
- **FastAPI 後端**：
  - 封裝對 Ollama 的 HTTP 呼叫，提供 `/chat`, `/extract_places`, `/embed` 等端點給內部使用。
  - 管理 PostgreSQL + pgvector 查詢與資料寫入。
  - 暴露給前端的業務 API，如 `/api/plan_trip_voice`、`/api/videos_for_destination` 等。[^1]
- **背景工作隊列**：
  - 用於非即時任務：下載 YouTube、Whisper 轉寫、字幕分段、批次 NER、地理編碼與 embedding 計算。[^15][^10]

### 2. 互動流程：一次語音查詢的生命週期

1. 使用者在前端按下「發話」按鈕，啟動 Web Speech API 的 `SpeechRecognition`：
   - 當辨識到完整句子或偵測使用者停止說話時，觸發 `onresult` 事件，取得文字結果（例如「我想去東京玩三天」）。[^3][^9]
2. 前端將文字連同當前地圖中心（例如使用者定位或預設國家）、使用者 ID 一起 POST 到 `/api/plan_trip_voice`。
3. FastAPI 在這個 handler 中：
   - 寫一筆 `conversation_logs` 記錄原始輸入文字，以便之後做偏好抽取與除錯。[^1]
   - 呼叫本地偏好抽取服務（可復用你既有的「使用者偏好與長期記憶系統」），萃取出旅遊風格、預算等資訊，或從歷史記錄中查詢既有偏好。[^18][^1]
   - 組成一個 `PlannerInput` JSON，包含：目的地候選、天數、預算、已知偏好、候選影片／景點列表（可分階段產生）。
4. 系統呼叫 Ollama 的「規劃模型」：
   - Prompt 中清楚規範輸出格式，例如：
   ```
   你是一個旅遊行程規劃助手，輸出 JSON。
   給定目的地、天數、使用者偏好，以及可用的景點與影片片段列表，請產生每日行程安排與對應影片片段的推薦。
   ...（略）
   ```
   - 傳入已初步解析出的目的地與候選景點／片段，讓模型在這些約束下排程而不是憑空想像。[^18][^14]
5. 規劃模型輸出結構化 JSON，例如：
   ```json
   {
     "destination": "東京",
     "days": [
       {
         "day": 1,
         "summary": "淺草與晴空塔",
         "stops": [
           {
             "placeId": "...",
             "placeName": "淺草寺",
             "videoSegmentId": 123,
             "startSec": 120
           },
           ...
         ]
       },
       ...
     ]
   }
   ```
6. FastAPI 驗證 JSON schema，將行程寫入資料庫的 `itineraries` 與 `itinerary_stops` 表，以便之後讓使用者修改或收藏。[^18]
7. 後端將行程 JSON、對應影片與地圖標記資料一起回傳前端。前端：
   - 地圖：根據 `stops` 中的 `lat/lng` 畫 marker 與動線。
   - 影片：顯示五個播放器，每個播放器的時間軸顯示對應 `videoSegmentId` 所代表的重點片段，可點擊跳轉時間。
   - 對話 UI：顯示系統以自然語言解釋為何這樣安排、以及推薦這些影片的原因。

### 3. 背景批次與即時互動的切割

為了在本地 Ollama 上維持流暢互動，建議將流程切成：

- **背景批次（離線）**：
  - 下載影片與字幕、Whisper 轉寫。
  - 字幕分段、NER 地點抽取、地理編碼、embedding 計算。
  - 每隔數小時更新指定城市的影片庫（例如東京、台北）。
- **即時互動（線上）**：
  - 只做目的地解析、從已建好的索引查資料、呼叫規劃 LLM 排程與產生自然語言說明。

這樣你就不需要在每次使用者講話時重新跑完整的影片分析，大幅降低延遲與硬體負擔。[^4][^10]

## 五、MVP 功能清單（優先順序）

下面整理一份以「先做得出 demo，再逐步加強」為方向的 MVP 功能清單，以優先級區分。

### P0（必做，Demo 級）

| 模組 | 功能 | 說明 |
|------|------|------|
| 地圖 UI | 顯示目標城市的 2D 地圖（先用 MapLibre） | 以文字輸入目的地後，地圖中心移到該城市，顯示基本底圖與可放大縮小[^5][^11]。 |
| 語音輸入 | 按住發話按鈕→Web Speech API→文字 | 前端完成語音→文字流程，若瀏覽器不支援則 fallback 成純文字輸入[^3][^6][^9]。 |
| 文字解析 | 後端解析目的地與天數 | 用一個簡單的 Ollama Prompt 將句子轉成 `{destination, days}` JSON。 |
| 影片推薦（簡化版） | 針對少數城市手動或半自動準備影片清單 | 先對「東京」「台北」等預先抓好 10–20 支影片，人工或簡單規則挑出其中 3–5 支推薦影片，完成五個小播放器顯示的 UI[^14]。 |
| 行程生成功能（粗略） | 根據目的地與天數產生每日景點列表 | 不必一開始就完全根據影片，只需用 AI 產生一個可改的行程草案，驗證對話→行程的體驗[^19][^18]。 |

P0 階段的核心是「完整串起從語音→地圖→影片→行程」這條線，即使影片與景點標記先是簡化版本，也要讓評審或使用者看到整體體驗。

### P1（加強版，影片片段與景點標記）

| 模組 | 功能 | 說明 |
|------|------|------|
| 字幕與片段管線 | 建立 YouTube→字幕→`video_segments` 的完整批次流程 | 如第三章所述，實作下載字幕／Whisper 轉寫與分段，並存入資料庫以支援查詢[^15][^10]。 |
| 地點 NER 與地理編碼 | 為每個片段抽取景點與座標 | 使用 Ollama NER 模型與 Geocoding API，建立 `segment_places` 表與 lat/lng 欄位[^4][^10]。 |
| 片段級影片播放器 | 在時間軸上標出可點擊的重點片段 | 前端 React Player 加上自訂時間軸 UI，顯示摘要與點擊跳轉功能[^14]。 |
| 地圖景點疊合 | 將影片片段中出現的景點標在地圖上 | 當選擇某支影片或某天行程，地圖上顯示對應景點的 marker，點擊可反向高亮影片片段[^4]。 |
| 行程與影片整合 | 行程中的每個 stop 都關聯至少一個影片片段 | 在規劃 LLM 的輸出格式中加入 `videoSegmentId` 等欄位，真正做到「看影片學行程」。 |

P1 做完後，你就有一個「會從影片裡抽景點並標在地圖上」的完整系統，符合你一開始的願景。

### P2（進階：個人化與全球化）

| 模組 | 功能 | 說明 |
|------|------|------|
| 個人化偏好整合 | 將你既有的短期／長期記憶系統導入影片推薦 | 使用者偏好（美食、自然、夜生活）轉 embedding，影片／片段也有 embedding，做語意相似度排序，讓推薦更個人化[^1][^14]。 |
| 3D 地球視圖 | 使用 CesiumJS 或 MapLibre Globe 顯示全球視圖 | 支援全球目的地概覽，讓使用者旋轉地球選城市，增強視覺效果[^2][^5][^8]。 |
| 多語言支援 | 語音與字幕分析支援中、英、日等 | 利用 Whisper 多語言能力與多語言 LLM，讓 AIYO 支援更多國家的旅遊影片與使用者[^15]。 |
| 動線優化與交通估計 | 結合地圖 API 的路徑與時間 | 將 Google Maps 或其它路線 API 的行車時間、步行時間納入行程排程，讓行程更實際[^19][^18]。 |

P2 階段主要是把系統從「好玩 demo」升級為「真的可以拿來規劃旅行」的工具，特別是個人化推薦與實際交通時間的整合。

## 六、結語

綜合以上，AIYO 想要的「地球地圖＋發話說目的地→自動推薦影片並標記景點→排出行程」在現有 Web 與 AI 生態系中是技術可行的，且已有不少開源元件與參考專案可以借鏡，從地圖呈現（MapLibre、Cesium）到語音輸入（Web Speech API），再到影片地點抽取與地圖標記（vOtpuskSam、Youtube to Travel、CV-to-Maps 等）。關鍵是將整個系統拆成可獨立開發的模組，先完成 P0 端到端體驗，再逐步加入影片片段、個人化偏好與全球擴展等功能。[^2][^10][^4]

這份規劃文件可作為你之後撰寫技術報告、海報與簡報的藍圖，也可以直接轉成實作 backlog（對應資料表、API、背景任務與前端元件），逐項完成與驗證。

---

## References

1. [詳細講解要怎麼樣才可以讓我網站中使用的AI(本地ollama)可以對使用者有短期和長期記憶，我希望在每次對話結束或是對話過程中都要有AI去判斷使用者的偏好，並且記錄下來，將這些記憶和紀錄給對話的AI進行旅遊安排和形成推薦以及影片偏好查詢](https://www.perplexity.ai/search/01df3341-82a7-44c2-b8c1-43aa109a935d) - 要讓你的網站中本地 Ollama AI 擁有短期（當前對話會話內）和長期（跨會話持久化）記憶，核心是透過後端 FastAPI 管理對話歷史、自動提取使用者偏好（如旅遊預算、喜歡景點類型、影片偏好），並...

2. [CesiumJS – Cesium](https://cesium.com/platform/cesiumjs/) - CesiumJS is an open source JavaScript library for creating world-class virtual 3D globes. For more t...

3. [Using the Web Speech API - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) - The Web Speech API provides two distinct areas of functionality — speech recognition and speech synt...

4. [AI powered map of YouTube travel videos (vOtpuskSam.ru) - BeWebi](https://bewebi.com/votpusksam-ru/) - AI powered daily feed of YouTube travel videos on a map, based on NLP and NER. The project shows cur...

5. [MapLibre](https://maplibre.org) - The MapLibre Organization is an umbrella for open-source mapping libraries.

6. [Web Speech API - MDN Web Docs - Mozilla](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) - The Web Speech API enables you to incorporate voice data into web apps. The Web Speech API has two p...

7. [Web Speech API - GitHub Pages](https://webaudio.github.io/web-speech-api/)

8. [Mapping libraries: a practical comparison - GISCARTA](https://giscarta.com/blog/mapping-libraries-a-practical-comparison) - Choosing among Leaflet, OpenLayers, Mapbox, Cesium, ArcGIS, deck.gl, and Google

9. [Voice driven web apps - Introduction to the Web Speech API | Blog](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api) - Voice Driven Web Apps - Introduction to the Web Speech API

10. [Source code · Youtube to Travel · Apify](https://apify.com/aliilhanege/youtubetotravel/source-code) - 💡 From YouTube Videos to Travel Plans! 🌍 Make trip planning smarter and easier with AI! 🚀 📌 How It W...

11. [MapLibre GL JS](https://maplibre.org/projects/gl-js/) - Open-source TypeScript library for publishing interactive, GPU-accelerated maps on the web.

12. [GitHub - sasha-kap/CV-to-Maps: Travel Video Object Detection with OSM-Based Evaluation](https://github.com/sasha-kap/CV-to-Maps) - Travel Video Object Detection with OSM-Based Evaluation - sasha-kap/CV-to-Maps

13. [Build Real Time Talking AI Voice Assistant - WebRTC OpenAI](https://www.youtube.com/watch?v=jNZbArKfwHs) - #aiagents #aiagent #aiapplications 

🤖 Build Real Time AI Voice Assistant - WebRTC OpenAI

Welcome 
...

14. [所以如果我已經作好一個簡易的Ai對話平台，我希望讓AI可以作為旅遊小助手適當的推薦我youtube影片並且幫助我一起安排行程，同時要顯示影片時需要顯示出五個小型react影片播放器，播放企要有影片的播放畫面、youtuber、觀看次數、點讚次數、整條時間軸並標示出重要時間戳記的內容摘要，讓我點擊之後可以跳轉到該影片位置(在我的網站中播放影片)，我希望AI最多就是從搜尋到的影片中挑選出五個影片給我，並且需要說明推薦原因。這樣要怎麼實作](https://www.perplexity.ai/search/bb1cd93b-65a4-47bd-8a51-a3c4b13d0a79) - 要實現你描述的這個 AI 旅遊小助手功能，並且在網站中顯示五個小型 React 影片播放器，帶有影片播放畫面、YouTuber 名稱、觀看次數、點讚數、且包含可點擊跳轉的重要時間戳記及內容摘要，整個流...

15. [繼續深入討論，我要怎麼實際製作影片搜尋推薦 根據使用者偏好 推薦片段 推薦內容 並且整合進旅遊地點規劃](https://www.perplexity.ai/search/3a030b17-6b99-49f1-ade6-bca92e0b4b03) - 在「AI 旅遊規劃平台」裡，要把 YouTube 影片推薦、推薦片段、推薦內容，做到「根據使用者偏好」，而且能自動整合進行程規劃，大方向是：

1. 先取得使用者偏好（興趣、語言、影片風格、天數、預算...

16. [在Mapbox APIs方面是否有其他免費開源的地圖可以使用?或是其他同樣可以顯示地球和地圖的方法?](https://www.perplexity.ai/search/29173965-2ae9-47d8-ae3d-7e6fc35db33e) - 若希望避開 Mapbox 的付費或配額限制，以下幾種免費／開源方案皆能提供地圖或地球視圖功能，並可與前端框架輕鬆整合。
Leaflet 是體積輕巧的 JavaScript 地圖函式庫，搭配 OpenS...

17. [他如果問我ollama模型embedding 模式是多少](https://www.perplexity.ai/search/0457aaf0-2d3e-46c9-8ac7-59cdd4e74172) - Q: Ollama模型的embedding維度是多少？

「我們使用nomic-embed-text模型（Ollama官方推薦），embedding維度是768。 這模型支援中文旅遊內容，MTEB準確...

18. [我的AI旅遊規劃網站要怎麼解決這些問題?](https://www.perplexity.ai/search/5132c717-7a66-4c36-9ba0-c0ed15cbec6c) - 這張圖列出四個核心痛點，可以對應到你現在 AI 旅遊網站的架構來設計功能與技術解法。以下用你熟悉的技術棧（React + FastAPI + PostgreSQL + pgvector + LLM）來...

19. [我要製作一個網站可以讓使用者規劃旅遊事項，包括詳細的行程內容交通方式和時間日期等內容，此外我還需要加入AI功能和youtube推薦影片功能，整體網站要主要讓AI個人化根據使用者的平時習慣和影片偏好進行推薦。

AI 個人化旅遊行程規劃平台
Product Requirements Document（PRD + Technical Design）
1. 產品概述（Product Overview）
1.1 產品定位（Vision）
本產品是一個以 AI 個人化推薦與多來源資料整合 為核心的旅遊行程...

...ing
AI Orchestration Coding
背景任務 n8n
ETL / AI pipeline n8n
Hybrid 是最佳解
9. MVP 範圍
MVP（第一階段）
使用者帳號
行程 CRUD
Google Maps
OpenAI 行程生成
PostgreSQL
Phase 2
pgvector
Ollama
影片摘要
天氣影響建議
10. 風險與技術注意事項
OpenAI rate limit
SERP API 成本
向量資料成長
Prompt 穩定性（JSON schema）](https://www.perplexity.ai/search/2898b52e-2aa0-4877-a7ab-cda3e6afd667) - 根據您提供的詳細 PRD 文件，這是一個設計完善的 AI 個人化旅遊規劃平台專案。以下是針對您的技術架構和實施方案的專業建議：

您的混合式 AI 架構（OpenAI + Ollama）是目前 202...

