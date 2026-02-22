# AIYO api-gateway

Node.js + Express API Gateway，負責：

- chat 轉發至 ai-service
- chat history（正式落 DB：chat_sessions/chat_messages；Redis 保留快取用途）
- itinerary CRUD（PostgreSQL）
- WebSocket 基礎通道（`/ws`）

## 端點

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/user/profile`
- `PUT /api/user/profile`
- `GET /api/user/memory`
- `POST /api/user/memory`
- `POST /api/chat`
- `GET /api/models`
- `GET /api/chat/history/:sessionId`
- `DELETE /api/chat/history/:sessionId`
- `POST /api/search-segments`（轉發 ai-service）
- `POST /api/itinerary`
- `GET /api/itinerary/:id`
- `PUT /api/itinerary/:id`
- `DELETE /api/itinerary/:id`

## WebSocket

- 路徑：`/ws`
- 需帶 token（query string：`/ws?token=<jwt>`）
- 事件：
  - `subscribe`：訂閱 session
  - `message`：基礎訊息廣播
  - `stream_response`：chat 串流轉發通知
  - `itinerary_update`：行程 CRUD 更新通知

## 啟動

```bash
npm install
npm run dev
```
