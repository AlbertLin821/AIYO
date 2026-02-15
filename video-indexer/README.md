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

## 使用方式

（待實作腳本後補齊）
