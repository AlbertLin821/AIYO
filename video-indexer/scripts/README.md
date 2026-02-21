# 影片索引腳本

## search_youtube.py

使用 YouTube Data API v3 搜尋旅遊影片，並將 metadata 寫入 `videos` 表。

### 前置條件

- 專案根目錄 `.env` 已設定 `DATABASE_URL`、`YOUTUBE_API_KEY`
- PostgreSQL 已啟動（docker compose up -d）
- 已安裝依賴：`pip install google-api-python-client python-dotenv psycopg2-binary`

### 使用方式

```bash
cd video-indexer
python scripts/search_youtube.py

# 或指定搜尋關鍵字
python scripts/search_youtube.py "台南美食" "嘉義景點"

# 僅搜尋不寫入（測試用）
python scripts/search_youtube.py --dry-run

# 限制每關鍵字影片數
python scripts/search_youtube.py --max-results 25
```

### 預設搜尋關鍵字

- 台灣旅遊
- 台南兩天一夜
- 台中一日遊
- 台北美食

---

## index_video.py

取得字幕、語意分段、景點抽取、寫入 segments / places / segment_places。

### 前置條件

- 已執行 search_youtube.py 將影片寫入 videos 表
- 安裝完整依賴：`pip install -r requirements.txt`（含 Whisper、sentence-transformers、httpx）
- FFmpeg 已安裝（Whisper 透過 yt-dlp 下載音訊時需要）
- Ollama 已啟動並下載模型（如 `ollama pull qwen2.5:7b-instruct`）

### 流程說明

1. 字幕取得：優先 youtube-transcript-api，無則用 Whisper 轉錄
2. 語意分段：paraphrase-multilingual-MiniLM-L12-v2 + cosine 閾值切段
3. 景點抽取：Ollama LLM 從片段文字抽取景點與類型
4. 寫入 DB：segments、places、segment_places

### 使用方式

```bash
cd video-indexer
python scripts/index_video.py --limit 3

# 指定 youtube_id
python scripts/index_video.py --ids dQw4w9WgXcQ abc123

# 無字幕時不使用 Whisper（僅用 transcript API）
python scripts/index_video.py --no-whisper

# 略過 Ollama 景點抽取（加快速度，適合先確認流程；tags 會為空）
python scripts/index_video.py --skip-places
```
