# AIYO ai-service

Python FastAPI 服務，負責 AI 對話、資料查詢與行程工具端點。

## 目前已實作

- `GET /health`
- `POST /api/chat`（串流轉發 Ollama，含 RAG 第一版與個人化 context）
- `POST /api/chat`（支援 Tool Calling：時間、天氣、旅遊資訊、YouTube、交通）
- `POST /api/tools/search-segments`（pgvector 檢索，含文字降級）
- `GET /api/videos`
- `GET /api/videos/{id}/segments`
- `GET /api/segments/{id}`
- `POST /api/tools/plan-itinerary`（MVP 版本）

## /api/chat 回傳補充

- 串流過程以 SSE `data:` 回傳 token
- 完成事件會夾帶 `recommended_videos`（最多 5 支）
- 完成事件會夾帶 `used_mcp_tools` 與 `tool_calls_summary`
- 推薦影片含縮圖、摘要與片段時間戳，供前端播放器跳轉

## 啟動方式

1. 建立虛擬環境並安裝套件
2. 設定環境變數（`DATABASE_URL`、`OLLAMA_BASE_URL`、`OLLAMA_MODEL`）
3. 啟動：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

OpenAPI: `http://localhost:8000/docs`

## 部署

### Docker 映像

```bash
docker build -t aiyo-ai-service .
```

### 執行

```bash
docker run --rm -p 8000:8000 \
  -e DATABASE_URL=... \
  -e OLLAMA_BASE_URL=... \
  -e OLLAMA_MODEL=... \
  -e AI_SERVICE_INTERNAL_TOKEN=... \
  aiyo-ai-service
```

說明：資料庫 migration 應在部署前由外部流程先完成，不應於服務啟動時自動執行。
