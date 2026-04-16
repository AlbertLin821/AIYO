# AIYO V2 Contract Implementation Notes

## Scope
- V2 frontend: `/v2`
- V2 API: `/api/v2/*`
- Legacy frontend: `/legacy`
- Optional V1 read-only mode: `V1_READONLY_MODE=true`

## ID Contract
- Public payloads use:
  - `internalPlaceId` (UUID, internal DB key)
  - `googlePlaceId` (nullable string)
  - `segmentId` (UUID from `v2.video_segments.id`)
- Legacy `placeId` is rejected by gateway with `422`.

## Sync + Async Paths
- `POST /api/v2/recommend/videos`
  - Fast sync path returns completed payload.
  - Timeout/degraded path returns `202 { jobId, pollAfterMs }`.
- `POST /api/v2/recommend/jobs`
- `GET /api/v2/recommend/jobs/{jobId}`
- `POST /api/v2/trips/plan-from-intent`
  - Fast sync path returns completed payload.
  - Timeout/degraded path returns `202 { jobId, pollAfterMs }`.
- `POST /api/v2/trips/plan-jobs`
- `GET /api/v2/trips/plan-jobs/{jobId}`

## Realtime Job Updates
- SSE endpoint: `GET /api/v2/jobs/{jobId}/events`
- WebSocket endpoint: `/ws` with `subscribe_job` / `unsubscribe_job` messages
- Frontend strategy:
  - Try WebSocket first.
  - Fallback to SSE on WS error/close.
  - Fallback to polling on SSE error.

## V2 Save Action
- V2 UI supports `voice -> recommend -> plan -> save` flow.
- Save button posts normalized itinerary payload to `POST /api/itinerary` (existing P1 endpoint).
- Saved result is shown in-page with created itinerary id.

## Embedding Contract
- P1 lock:
  - model: `nomic-embed-text`
  - dim: `768`
- Tables include:
  - `model_name`, `model_version`, `dim`, `created_at`
- Gateway/AI service reject mismatched model/version/dim with `422`.
- Vector schema supports future model transitions with dimension checks.

## Geocode Rules
- `v2.segment_places` contains:
  - `geocode_status` (`ok|failed|pending`)
  - `geocode_confidence`
  - `geocode_retry_count`
  - `last_geocode_attempt_at`
- Retry exhaustion policy:
  - pending rows with `geocode_retry_count >= V2_GEOCODE_MAX_RETRIES` are marked as `failed`.
- Product behavior:
  - `failed` can still appear in recommendation/timeline cards.
  - `failed` does not render map marker.
  - `failed` is excluded from automatic trip stops and exposed as manual-confirmation candidates.

## YouTube Stats Freshness
- Output includes:
  - `statsUpdatedAt`
  - `statsStale`
- TTL controlled by `V2_YOUTUBE_STATS_TTL_HOURS` (default 24h).
- On stale/quota constraints, API returns cached values with `statsStale=true`.

## Traceability
- Gateway normalizes/creates `x-trace-id` for `/api/v2/*`.
- AI service propagates `traceId` in responses.
- V2 logging tables store `trace_id`:
  - `v2.voice_intent_logs`
  - `v2.recommendation_events`
  - `v2.planner_runs`

## Phase C Routing
- `NEXT_PUBLIC_PHASE_C_READONLY=true` redirect rules:
  - `/` -> `/v2`
  - `/home` -> `/legacy`
- Legacy mode keeps read-only UX during migration window.

## Verification
- Frontend E2E:
  - `frontend/e2e/v2.spec.ts` (route smoke checks)
  - `frontend/e2e/v2-flow.spec.ts` (voice -> recommend -> map -> plan -> save with mocked APIs)
