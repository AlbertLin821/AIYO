# 影片索引器 (Video Indexer)

AIYO 愛遊 - 影片索引與片段切割模組

## 功能

1. 使用 YouTube Data API 搜尋並取得影片 metadata
2. 取得字幕（YouTube Captions API 或 Whisper 轉錄）
3. 語意分段（Semantic Segmentation）
4. 景點實體抽取（NER + LLM）
5. 寫入 PostgreSQL + pgvector

## 環境需求

- Python 3.10+
- PostgreSQL with pgvector（見專案根目錄 docker-compose.yml）
- YouTube API 金鑰

## 安裝

```bash
cd video-indexer
pip install -r requirements.txt
```

## 環境變數

請在專案根目錄建立 `.env`，參考 `.env.example`。

必要變數：
- `DATABASE_URL`
- `YOUTUBE_API_KEY`

索引流程（index_video）額外需要：
- `OLLAMA_BASE_URL`、`OLLAMA_MODEL`（景點抽取，預設 localhost:11434、qwen2.5:7b-instruct）

## 系統需求

- **FFmpeg**：使用 Whisper 轉錄無字幕影片時，yt-dlp 需 FFmpeg 擷取音訊。請預先安裝。

## 使用方式

### 1. YouTube 影片搜尋與寫入

詳見 [scripts/README.md](./scripts/README.md)。快速開始：

```bash
cd video-indexer
python -m venv .venv
.venv\Scripts\Activate.ps1   # Windows
pip install google-api-python-client python-dotenv psycopg2-binary

# 測試（需已設定 YOUTUBE_API_KEY）
python scripts/search_youtube.py --dry-run

# 正式執行，寫入資料庫
python scripts/search_youtube.py
```
