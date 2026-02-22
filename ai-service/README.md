# AIYO ai-service

Python FastAPI 服務，負責 AI 對話、資料查詢與行程工具端點。

## 目前已實作

- `GET /health`
- `POST /api/chat`（串流轉發 Ollama，含 RAG 第一版與個人化 context）
- `POST /api/tools/search-segments`（pgvector 檢索，含文字降級）
- `GET /api/videos`
- `GET /api/videos/{id}/segments`
- `GET /api/segments/{id}`
- `POST /api/tools/plan-itinerary`（MVP 版本）

## /api/chat 回傳補充

- 串流過程以 SSE `data:` 回傳 token
- 完成事件會夾帶 `recommended_videos`（最多 5 支）
- 推薦影片含縮圖、摘要與片段時間戳，供前端播放器跳轉

## 啟動方式

1. 建立虛擬環境並安裝套件
2. 設定環境變數（`DATABASE_URL`、`OLLAMA_BASE_URL`、`OLLAMA_MODEL`）
3. 啟動：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

OpenAPI: `http://localhost:8000/docs`
