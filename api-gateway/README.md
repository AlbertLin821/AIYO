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
- `GET /api/user/ai-settings`
- `PUT /api/user/ai-settings`
- `PUT /api/user/location`
- `GET /api/user/memory`
- `POST /api/user/memory`
- `POST /api/chat`
- `GET /api/models`
- `GET /api/recommendation/metrics`
- `GET /api/recommendation/ctr-weekly`
- `GET /api/chat/history/:sessionId`
- `DELETE /api/chat/history/:sessionId`
- `POST /api/search-segments`（轉發 ai-service）
- `POST /api/itinerary`
- `POST /api/itinerary/reoptimize`
- `GET /api/itinerary`
- `GET /api/itinerary/:id`
- `PUT /api/itinerary/:id`
- `DELETE /api/itinerary/:id`

### Developer Console (dev-only)

- `POST /api/dev/login`
- `POST /api/dev/logout`
- `GET /api/dev/me`
- `GET /api/dev/users`
- `GET /api/dev/users/:id/profile`
- `GET /api/dev/users/:id/memories`
- `GET /api/dev/users/:id/chat-sessions`
- `GET /api/dev/users/:id/chat-history/:sessionId`
- `GET /api/dev/users/:id/itineraries`
- `GET /api/dev/audit-logs`
- `GET /api/dev/login-events`
- `GET /api/dev/quality-dashboard`
- `GET /api/dev/recommendation/ctr-weekly`

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

## 部署

### Docker 映像

```bash
docker build -t aiyo-api-gateway .
```

### 先執行 migration 再部署

```bash
npm run migrate:dry-run
npm run migrate:deploy
```

注意：migration 應在部署前單獨執行，不建議綁在 `npm start`。

## 離線品質基線量測

可使用以下腳本執行 golden set 離線評估，並將指標寫入 `quality_baselines`：

```bash
node scripts/run_offline_baseline.js
```

可調整環境變數：

- `API_GATEWAY_URL`：預設 `http://localhost:3001`
- `OFFLINE_EVAL_EMAIL`、`OFFLINE_EVAL_PASSWORD`：評估帳號（不存在會自動註冊）
- `OFFLINE_EVAL_DATASET`：評估集路徑，預設 `benchmark/offline_golden_set.json`
- `OFFLINE_EVAL_PERSIST`：是否寫入 DB，預設 `true`
- `OFFLINE_EVAL_TIMEOUT_MS`：單次請求逾時毫秒數，預設 `25000`

## 推薦基線定期重算

可使用以下腳本重算推薦事件基線（7 天與 30 天）：

```bash
node scripts/recompute_recommendation_baselines.js
```

或使用 npm script：

```bash
npm run baseline:recompute
```

建議排程（每日或每週）呼叫上面指令，將以下指標持續寫入 `quality_baselines`：

- `recommendation.ctr.7d` / `recommendation.ctr.30d`
- `recommendation.segment_jump_rate.7d` / `recommendation.segment_jump_rate.30d`
- `recommendation.adopt_rate.7d` / `recommendation.adopt_rate.30d`
- `recommendation.dismiss_rate.7d` / `recommendation.dismiss_rate.30d`
- `recommendation.unique_users.7d` / `recommendation.unique_users.30d`
- `recommendation.ctr.weekly`（逐週 CTR 快照）
- `recommendation.ctr.wow_weekly`（逐週 CTR 變化）
