from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
import psycopg
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from app.tools.agent import resolve_tool_context
from app.tools.youtube import search_youtube_videos
from app.personalization import (
    UserFeatures,
    merge_user_features,
    features_to_keywords,
    features_to_scoring_context,
    features_to_system_context,
)
from app.reranker import (
    build_candidates_from_db_rows,
    build_candidates_from_youtube_api,
    rerank_candidates,
    scored_to_response,
)
from app.planner import (
    PlannerConstraints,
    plan_itinerary_v2,
    planner_result_to_response,
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str = Field(min_length=1)
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[str] = None
    stream: bool = True
    city: Optional[str] = None
    user_id: Optional[int] = None
    trace_id: Optional[str] = None


class PlanItineraryRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=14)
    preferences: List[str] = Field(default_factory=list)
    segments: List[Dict[str, Any]] = Field(default_factory=list)
    user_id: Optional[int] = None
    budget_total: Optional[float] = None
    budget_per_day: Optional[float] = None
    must_visit: List[str] = Field(default_factory=list)
    avoid: List[str] = Field(default_factory=list)


class SearchSegmentsRequest(BaseModel):
    query: str = Field(min_length=1)
    city: Optional[str] = None
    limit: int = Field(default=10, ge=1, le=50)
    embedding_model: Optional[str] = None


class PreferenceExtractResult(BaseModel):
    budget: Optional[str] = None
    travel_likes: List[str] = Field(default_factory=list)
    video_likes: List[str] = Field(default_factory=list)
    pace: Optional[str] = None
    transport: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    preferred_cities: List[str] = Field(default_factory=list)


def get_env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


DATABASE_URL = get_env("DATABASE_URL", "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db")
OLLAMA_BASE_URL = get_env("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = get_env("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_EMBED_MODEL = get_env("OLLAMA_EMBED_MODEL", "nomic-embed-text")
INTERNAL_SERVICE_TOKEN = get_env("AI_SERVICE_INTERNAL_TOKEN", "")
ALLOWED_GATEWAY_ORIGINS = [item.strip() for item in get_env("AI_SERVICE_ALLOWED_ORIGINS", "http://localhost:3001").split(",") if item.strip()]
ALLOWED_INTERNAL_IPS = [item.strip() for item in get_env("AI_SERVICE_ALLOWED_IPS", "127.0.0.1,::1").split(",") if item.strip()]
SENTRY_DSN = get_env("SENTRY_DSN", "")
ENABLE_MCP_TOOLS = get_env("ENABLE_MCP_TOOLS", "true").lower() == "true"
MCP_DEFAULT_TIMEZONE = get_env("MCP_DEFAULT_TIMEZONE", "Asia/Taipei")
MCP_TRAVEL_SEARCH_MAX_RESULTS = max(1, min(8, int(get_env("MCP_TRAVEL_SEARCH_MAX_RESULTS", "5"))))
HTTP_USER_AGENT = get_env("AI_SERVICE_HTTP_USER_AGENT", "AIYO/1.0 (+travel-assistant)")
YOUTUBE_API_KEY = get_env("YOUTUBE_API_KEY", "")
GOOGLE_MAPS_API_KEY = get_env("GOOGLE_MAPS_API_KEY", "")
ENABLE_WEATHER_TOOL = get_env("ENABLE_WEATHER_TOOL", "true").lower() == "true"
ENABLE_YOUTUBE_TOOL = get_env("ENABLE_YOUTUBE_TOOL", "true").lower() == "true"
ENABLE_TRANSPORT_TOOL = get_env("ENABLE_TRANSPORT_TOOL", "true").lower() == "true"
ENABLE_TRAVEL_INFO_TOOL = get_env("ENABLE_TRAVEL_INFO_TOOL", "true").lower() == "true"
TOOL_AGENT_MAX_ROUNDS = max(1, min(6, int(get_env("TOOL_AGENT_MAX_ROUNDS", "3"))))
TOOL_AGENT_MAX_CALLS_PER_ROUND = max(1, min(8, int(get_env("TOOL_AGENT_MAX_CALLS_PER_ROUND", "4"))))

app = FastAPI(title="AIYO ai-service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_GATEWAY_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
    )

Instrumentator().instrument(app).expose(app, include_in_schema=False, endpoint="/metrics")


def require_internal_caller(request: Request, x_internal_token: Optional[str] = Header(default=None)) -> None:
    if INTERNAL_SERVICE_TOKEN and x_internal_token == INTERNAL_SERVICE_TOKEN:
        return
    client_ip = ""
    if request.client and request.client.host:
        client_ip = request.client.host
    forwarded_for = request.headers.get("x-forwarded-for") or ""
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip() or client_ip
    if client_ip in ALLOWED_INTERNAL_IPS:
        return
    raise HTTPException(status_code=403, detail="forbidden")


def get_conn() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def to_vector_literal(vector: List[float]) -> str:
    return "[" + ",".join(str(x) for x in vector) + "]"


def dedup_non_empty(items: List[str], limit: int = 12) -> List[str]:
    result: List[str] = []
    seen = set()
    for item in items:
        text = (item or "").strip()
        if not text:
            continue
        if text not in seen:
            seen.add(text)
            result.append(text)
        if len(result) >= limit:
            break
    return result


def fetch_all(query: str, params: tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return list(cur.fetchall())


def fetch_one(query: str, params: tuple[Any, ...] = ()) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchone()


async def embedding_from_ollama(text: str, model: Optional[str] = None) -> Optional[List[float]]:
    embed_model = model or OLLAMA_EMBED_MODEL
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        # Ollama 新版 API
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/embed",
            json={"model": embed_model, "input": text},
        )
        if response.status_code < 400:
            data = response.json()
            embeddings = data.get("embeddings")
            if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
                return embeddings[0]

        # 舊版相容 API
        legacy = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": embed_model, "prompt": text},
        )
        if legacy.status_code < 400:
            data = legacy.json()
            embedding = data.get("embedding")
            if isinstance(embedding, list):
                return embedding
    return None


async def extract_preferences_from_conversation(messages: List[ChatMessage]) -> Optional[PreferenceExtractResult]:
    recent = messages[-10:]
    if not recent:
        return None
    conversation_lines = [
        f"{idx + 1}. [{item.role}] {(item.content or '').replace(chr(10), ' ').strip()[:220]}"
        for idx, item in enumerate(recent)
        if (item.content or "").strip()
    ]
    if not conversation_lines:
        return None
    prompt = (
        "請僅根據以下對話萃取『旅遊相關偏好』，忽略敏感資料與無關資訊。\n"
        "只回傳 JSON，格式為：\n"
        "{"
        "\"budget\": \"\", "
        "\"travel_likes\": [], "
        "\"video_likes\": [], "
        "\"pace\": \"\", "
        "\"transport\": \"\", "
        "\"constraints\": [], "
        "\"preferred_cities\": []"
        "}\n\n"
        "規則：\n"
        "1) 未出現可留空字串或空陣列。\n"
        "2) 陣列元素要短、可重用、避免整句複製。\n"
        "3) 僅萃取旅遊規劃有用的資訊。\n\n"
        "[對話]\n"
        + "\n".join(conversation_lines)
    )
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "format": "json",
                "messages": [
                    {"role": "system", "content": "你是旅遊偏好抽取器，輸出必須是 JSON。"},
                    {"role": "user", "content": prompt},
                ],
                "options": {"temperature": 0.1, "num_predict": 512},
            },
        )
    if response.status_code >= 400:
        return None
    data = response.json()
    raw_content = ((data.get("message") or {}).get("content") or "").strip()
    if not raw_content:
        return None
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError:
        return None
    try:
        model = PreferenceExtractResult.model_validate(parsed)
    except Exception:
        return None

    # 將模型輸出做最小清理，避免異常資料污染長期偏好
    cleaned = PreferenceExtractResult(
        budget=(model.budget or "").strip() or None,
        travel_likes=dedup_non_empty(model.travel_likes, limit=10),
        video_likes=dedup_non_empty(model.video_likes, limit=8),
        pace=(model.pace or "").strip() or None,
        transport=(model.transport or "").strip() or None,
        constraints=dedup_non_empty(model.constraints, limit=10),
        preferred_cities=dedup_non_empty(model.preferred_cities, limit=10),
    )
    return cleaned


def upsert_user_preferences(user_id: int, preferences: PreferenceExtractResult, embedding: List[float]) -> None:
    vector_literal = to_vector_literal(embedding)
    with get_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))
                cur.execute(
                    """
                    INSERT INTO user_preferences (user_id, preferences_json, embedding_vector, updated_at)
                    VALUES (%s, %s::jsonb, %s::vector, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET
                      preferences_json = EXCLUDED.preferences_json,
                      embedding_vector = EXCLUDED.embedding_vector,
                      updated_at = NOW()
                    """,
                    (user_id, json.dumps(preferences.model_dump(), ensure_ascii=False), vector_literal),
                )


async def maybe_extract_and_store_preferences(user_id: Optional[int], history: List[ChatMessage]) -> None:
    if not user_id:
        return
    user_turn_count = sum(1 for item in history if item.role == "user")
    if user_turn_count == 0 or user_turn_count % 3 != 0:
        return
    extracted = await extract_preferences_from_conversation(history)
    if not extracted:
        return
    payload_text = json.dumps(extracted.model_dump(), ensure_ascii=False)
    embedding = await embedding_from_ollama(payload_text)
    if not embedding:
        return
    upsert_user_preferences(user_id, extracted, embedding)


async def retrieve_user_preferences(
    user_id: Optional[int],
    query: str,
    limit: int = 5,
    similarity_threshold: float = 0.8,
) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    query_embedding = await embedding_from_ollama(query)
    if not query_embedding:
        return []
    vector_literal = to_vector_literal(query_embedding)
    max_distance = max(0.0, 1.0 - similarity_threshold)
    try:
        with get_conn() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))
                    cur.execute(
                        """
                        SELECT id, preferences_json, updated_at, (embedding_vector <=> %s::vector) AS distance
                        FROM user_preferences
                        WHERE user_id = %s
                          AND embedding_vector IS NOT NULL
                          AND (embedding_vector <=> %s::vector) <= %s
                        ORDER BY distance ASC, updated_at DESC
                        LIMIT %s
                        """,
                        (vector_literal, user_id, vector_literal, max_distance, max(3, min(limit, 5))),
                    )
                    rows = list(cur.fetchall())
    except Exception:
        return []
    items: List[Dict[str, Any]] = []
    for row in rows:
        pref = row.get("preferences_json")
        if isinstance(pref, dict):
            items.append(
                {
                    "preferences_json": pref,
                    "distance": float(row.get("distance") or 0.0),
                    "updated_at": row.get("updated_at"),
                }
            )
    return items


def build_rag_context(items: List[Dict[str, Any]]) -> str:
    if not items:
        return ""
    lines = []
    for idx, item in enumerate(items, start=1):
        summary = (item.get("summary") or "").strip()
        tags = item.get("tags")
        tags_text = json.dumps(tags, ensure_ascii=False) if tags is not None else "[]"
        lines.append(
            f"{idx}. segment_id={item.get('id')} video_id={item.get('video_id')} "
            f"time={item.get('start_sec')}-{item.get('end_sec')} city={item.get('city') or ''}\n"
            f"summary: {summary}\n"
            f"tags: {tags_text}"
        )
    return "\n\n".join(lines)


def build_user_profile_context(user_id: Optional[int]) -> str:
    if not user_id:
        return ""
    recent_dialogue = fetch_all(
        """
        SELECT m.role, m.content, m.created_at
        FROM chat_messages m
        JOIN chat_sessions s ON s.id = m.session_id
        WHERE s.user_id = %s
        ORDER BY m.created_at DESC
        LIMIT 10
        """,
        (user_id,),
    )
    profile = fetch_one(
        """
        SELECT display_name, travel_style, budget_pref, pace_pref, transport_pref, dietary_pref, preferred_cities
        FROM user_profiles
        WHERE user_id = %s
        """,
        (user_id,),
    )
    memories = fetch_all(
        """
        SELECT memory_type, memory_text, confidence, source, created_at
        FROM user_memories
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 12
        """,
        (user_id,),
    )
    if not profile and not memories and not recent_dialogue:
        return ""

    lines: List[str] = []
    if recent_dialogue:
        lines.append("短期記憶（近期對話重點）：")
        for idx, item in enumerate(reversed(recent_dialogue), start=1):
            role = item.get("role") or "user"
            content = (item.get("content") or "").replace("\n", " ").strip()
            if not content:
                continue
            lines.append(f"{idx}. [{role}] {content[:180]}")

    if profile:
        lines.append("長期記憶（使用者偏好檔）：")
        lines.append(
            json.dumps(
                {
                    "display_name": profile.get("display_name"),
                    "travel_style": profile.get("travel_style"),
                    "budget_pref": profile.get("budget_pref"),
                    "pace_pref": profile.get("pace_pref"),
                    "transport_pref": profile.get("transport_pref"),
                    "dietary_pref": profile.get("dietary_pref"),
                    "preferred_cities": profile.get("preferred_cities"),
                },
                ensure_ascii=False,
            )
        )
    if memories:
        lines.append("長期記憶（已擷取個人事實）：")
        for idx, item in enumerate(memories, start=1):
            lines.append(
                f"{idx}. type={item.get('memory_type')} confidence={item.get('confidence')} "
                f"source={item.get('source')} text={item.get('memory_text')}"
            )
    return "\n".join(lines)


def get_user_personalization_signals(user_id: Optional[int]) -> Dict[str, Any]:
    if not user_id:
        return {"keywords": [], "preferred_cities": set(), "budget_pref": "", "pace_pref": ""}
    profile = fetch_one(
        """
        SELECT travel_style, budget_pref, pace_pref, transport_pref, dietary_pref, preferred_cities
        FROM user_profiles
        WHERE user_id = %s
        """,
        (user_id,),
    )
    memories = fetch_all(
        """
        SELECT memory_text
        FROM user_memories
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 20
        """,
        (user_id,),
    )

    keywords: List[str] = []
    preferred_cities = set()
    budget_pref = ""
    pace_pref = ""

    if profile:
        for key in ["travel_style", "transport_pref", "dietary_pref"]:
            value = (profile.get(key) or "").strip()
            if value:
                keywords.extend([word for word in value.replace("、", " ").replace(",", " ").split(" ") if word])
        budget_pref = (profile.get("budget_pref") or "").strip()
        pace_pref = (profile.get("pace_pref") or "").strip()
        cities = profile.get("preferred_cities") or []
        if isinstance(cities, list):
            for city in cities:
                if isinstance(city, str) and city.strip():
                    preferred_cities.add(city.strip())

    for item in memories:
        text = (item.get("memory_text") or "").strip()
        if text:
            keywords.extend([word for word in text.replace("、", " ").replace(",", " ").split(" ") if len(word) >= 2])

    # 去重，避免同一關鍵字重複加權
    dedup_keywords = []
    seen = set()
    for kw in keywords:
        if kw not in seen:
            dedup_keywords.append(kw)
            seen.add(kw)

    return {
        "keywords": dedup_keywords[:30],
        "preferred_cities": preferred_cities,
        "budget_pref": budget_pref,
        "pace_pref": pace_pref,
    }


def get_user_ai_settings(user_id: Optional[int]) -> Dict[str, Any]:
    if not user_id:
        return {}
    row = fetch_one(
        """
        SELECT tool_policy_json, weather_default_region, auto_use_current_location, current_lat, current_lng, current_region, updated_at
        FROM user_ai_settings
        WHERE user_id = %s
        """,
        (user_id,),
    )
    if not row:
        return {}
    return row


def build_user_features(user_id: Optional[int]) -> Optional[UserFeatures]:
    if not user_id:
        return None
    profile = fetch_one(
        "SELECT display_name, travel_style, budget_pref, pace_pref, transport_pref, dietary_pref, preferred_cities FROM user_profiles WHERE user_id = %s",
        (user_id,),
    )
    memories = fetch_all(
        "SELECT memory_type, memory_text, confidence FROM user_memories WHERE user_id = %s ORDER BY created_at DESC LIMIT 15",
        (user_id,),
    )
    pref_row = fetch_one(
        "SELECT preferences_json FROM user_preferences WHERE user_id = %s ORDER BY updated_at DESC LIMIT 1",
        (user_id,),
    )
    preferences_json = (pref_row.get("preferences_json") if pref_row else None)
    ai_settings = get_user_ai_settings(user_id)
    return merge_user_features(
        user_id=user_id,
        profile=profile,
        memories=memories,
        preferences_json=preferences_json if isinstance(preferences_json, dict) else None,
        ai_settings=ai_settings,
    )


AUDIT_SENSITIVE_KEYS = {
    "password", "password_hash", "token", "access_token", "refresh_token",
    "authorization", "cookie", "set-cookie", "x-internal-token",
    "secret", "api_key", "apikey",
}


def _mask_sensitive(obj: Any, depth: int = 0) -> Any:
    if depth > 8 or obj is None:
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, list):
        return [_mask_sensitive(item, depth + 1) for item in obj]
    if isinstance(obj, dict):
        masked = {}
        for k, v in obj.items():
            if k.lower() in AUDIT_SENSITIVE_KEYS:
                masked[k] = "***MASKED***" if isinstance(v, str) and v else v
            else:
                masked[k] = _mask_sensitive(v, depth + 1)
        return masked
    return obj


def write_audit_log(
    trace_id: Optional[str] = None,
    user_id: Optional[int] = None,
    session_id: Optional[str] = None,
    endpoint: Optional[str] = None,
    method: Optional[str] = None,
    status_code: Optional[int] = None,
    request_json: Any = None,
    response_json: Any = None,
    ai_prompt_json: Any = None,
    ai_response_json: Any = None,
    tool_calls_json: Any = None,
    error_text: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    try:
        masked_req = _mask_sensitive(request_json)
        masked_res = _mask_sensitive(response_json)
        masked_prompt = _mask_sensitive(ai_prompt_json)
        masked_ai_res = _mask_sensitive(ai_response_json)
        masked_tools = _mask_sensitive(tool_calls_json)
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            conn.execute(
                """
                INSERT INTO developer_audit_logs
                  (trace_id, user_id, session_id, endpoint, method, status_code,
                   request_json, response_json, ai_prompt_json, ai_response_json,
                   tool_calls_json, error_text, duration_ms)
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
                """,
                (
                    trace_id,
                    user_id,
                    session_id,
                    endpoint,
                    method,
                    status_code,
                    json.dumps(masked_req or {}, ensure_ascii=False, default=str),
                    json.dumps(masked_res or {}, ensure_ascii=False, default=str),
                    json.dumps(masked_prompt or {}, ensure_ascii=False, default=str),
                    json.dumps(masked_ai_res or {}, ensure_ascii=False, default=str),
                    json.dumps(masked_tools or [], ensure_ascii=False, default=str),
                    error_text,
                    duration_ms,
                ),
            )
    except Exception as exc:
        print(f"[audit] write_audit_log failed: {exc}")


def get_user_interaction_scores(user_id: Optional[int]) -> Dict[str, float]:
    if not user_id:
        return {}
    try:
        rows = fetch_all(
            """
            SELECT
              COALESCE(re.youtube_id, v.youtube_id) AS youtube_id,
              SUM(
                CASE re.event_type
                  WHEN 'click' THEN 1.0
                  WHEN 'segment_jump' THEN 0.8
                  WHEN 'itinerary_adopt' THEN 1.5
                  WHEN 'dismiss' THEN -1.2
                  ELSE 0.0
                END
              ) AS weighted_score
            FROM recommendation_events re
            LEFT JOIN videos v ON v.id = re.video_id
            WHERE re.user_id = %s
              AND re.created_at >= NOW() - INTERVAL '90 days'
              AND COALESCE(re.youtube_id, v.youtube_id) IS NOT NULL
            GROUP BY COALESCE(re.youtube_id, v.youtube_id)
            HAVING SUM(
              CASE re.event_type
                WHEN 'click' THEN 1.0
                WHEN 'segment_jump' THEN 0.8
                WHEN 'itinerary_adopt' THEN 1.5
                WHEN 'dismiss' THEN -1.2
                ELSE 0.0
              END
            ) <> 0
            """,
            (user_id,),
        )
    except Exception:
        return {}

    scores: Dict[str, float] = {}
    for row in rows:
        youtube_id = row.get("youtube_id")
        if not isinstance(youtube_id, str) or not youtube_id.strip():
            continue
        try:
            scores[youtube_id.strip()] = float(row.get("weighted_score") or 0.0)
        except (TypeError, ValueError):
            continue
    return scores


async def get_recommended_videos(
    query: str,
    city: Optional[str],
    user_id: Optional[int],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    features = build_user_features(user_id)
    scoring_ctx = features_to_scoring_context(features) if features else {
        "keywords": [], "preferred_cities": set(), "budget_pref": "",
        "pace_pref": "", "transport_pref": "", "dietary_pref": "",
        "constraints": [], "current_region": "",
    }

    city_filter = ""
    params: List[Any] = []
    if city:
        city_filter = "AND s.city = %s"
        params.append(city)
    params.extend([f"%{query}%", f"%{query}%", f"%{query}%"])

    db_rows = fetch_all(
        f"""
        SELECT s.id AS segment_id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
               v.youtube_id, v.title, v.channel, v.duration
        FROM segments s
        JOIN videos v ON v.id = s.video_id
        WHERE (s.summary ILIKE %s OR s.tags::text ILIKE %s OR v.title ILIKE %s)
          {city_filter}
        ORDER BY s.created_at DESC
        LIMIT 80
        """,
        tuple(params[-3:] + params[:-3]) if city else tuple(params),
    )

    candidates = build_candidates_from_db_rows(db_rows)

    # 補齊即時候選來源：當 DB 候選不足時，併入 YouTube API 搜尋結果再統一重排。
    if YOUTUBE_API_KEY:
        youtube_result = await search_youtube_videos(
            query=query,
            location=city,
            max_results=max(limit * 2, 5),
            youtube_api_key=YOUTUBE_API_KEY,
        )
        youtube_rows: List[Dict[str, Any]] = []
        if youtube_result.get("ok"):
            data = youtube_result.get("data")
            if isinstance(data, dict) and isinstance(data.get("videos"), list):
                youtube_rows = data.get("videos") or []
        youtube_candidates = build_candidates_from_youtube_api(youtube_rows)
        if youtube_candidates:
            seen_youtube_ids = {
                c.youtube_id for c in candidates if isinstance(c.youtube_id, str) and c.youtube_id
            }
            for candidate in youtube_candidates:
                if candidate.youtube_id and candidate.youtube_id in seen_youtube_ids:
                    continue
                candidates.append(candidate)
                if candidate.youtube_id:
                    seen_youtube_ids.add(candidate.youtube_id)
    scored = rerank_candidates(
        candidates=candidates,
        keywords=scoring_ctx["keywords"],
        preferred_cities=scoring_ctx["preferred_cities"],
        budget_pref=scoring_ctx["budget_pref"],
        pace_pref=scoring_ctx["pace_pref"],
        constraints=scoring_ctx["constraints"],
        interaction_scores=get_user_interaction_scores(user_id),
        limit=limit,
    )
    return scored_to_response(scored)


def get_mcp_tool_definitions() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "mcp_get_current_time",
                "description": "查詢目前時間，支援指定時區（例如 Asia/Taipei）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timezone": {
                            "type": "string",
                            "description": "IANA 時區名稱，例如 Asia/Taipei、Asia/Tokyo、Europe/Paris。",
                        }
                    },
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mcp_search_travel",
                "description": "使用搜尋引擎查詢旅遊即時資訊（景點、營業時間、交通、票價、活動）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜尋關鍵字。"},
                        "region": {"type": "string", "description": "地區，例如 台北、東京、京都。"},
                        "limit": {"type": "integer", "description": "回傳筆數，1 到 8。"},
                    },
                    "required": ["query"],
                },
            },
        },
    ]


def parse_tool_arguments(raw_arguments: Any) -> Dict[str, Any]:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if isinstance(raw_arguments, str):
        text = raw_arguments.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def extract_ollama_tool_calls(message: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_calls = message.get("tool_calls")
    if not isinstance(raw_calls, list):
        return []
    calls: List[Dict[str, Any]] = []
    for item in raw_calls:
        if not isinstance(item, dict):
            continue
        function_obj = item.get("function") if isinstance(item.get("function"), dict) else {}
        name = function_obj.get("name") or item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        arguments = parse_tool_arguments(function_obj.get("arguments", item.get("arguments")))
        calls.append({"name": name.strip(), "arguments": arguments})
    return calls


async def mcp_get_current_time(timezone: Optional[str]) -> Dict[str, Any]:
    timezone_name = (timezone or MCP_DEFAULT_TIMEZONE).strip() or MCP_DEFAULT_TIMEZONE
    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        timezone_name = MCP_DEFAULT_TIMEZONE
        zone = ZoneInfo(timezone_name)
    now = datetime.now(zone)
    return {
        "timezone": timezone_name,
        "iso": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "weekday": now.strftime("%A"),
        "unix": int(now.timestamp()),
    }


def _flatten_duckduckgo_related_topics(items: Any, output: List[Dict[str, str]], limit: int) -> None:
    if not isinstance(items, list) or len(output) >= limit:
        return
    for item in items:
        if len(output) >= limit:
            return
        if isinstance(item, dict) and isinstance(item.get("Topics"), list):
            _flatten_duckduckgo_related_topics(item.get("Topics"), output, limit)
            continue
        if not isinstance(item, dict):
            continue
        text = (item.get("Text") or "").strip()
        url = (item.get("FirstURL") or "").strip()
        if not text:
            continue
        title, _, snippet = text.partition(" - ")
        output.append(
            {
                "title": (title or text)[:160],
                "snippet": (snippet or text)[:300],
                "url": url,
                "source": "duckduckgo",
            }
        )


def _is_weather_query(text: str) -> bool:
    normalized = (text or "").lower()
    weather_keywords = ["天氣", "氣溫", "溫度", "降雨", "下雨", "weather", "forecast", "rain", "temperature"]
    return any(token.lower() in normalized for token in weather_keywords)


async def resolve_region_from_coordinates(lat: float, lng: float) -> Optional[str]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"format": "jsonv2", "lat": lat, "lon": lng, "accept-language": "zh-TW"},
            headers={"User-Agent": HTTP_USER_AGENT},
        )
    if response.status_code >= 400:
        return None
    data = response.json() if response.content else {}
    address = data.get("address") if isinstance(data, dict) else {}
    if isinstance(address, dict):
        for key in ["city", "town", "county", "state", "country"]:
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:120]
    display_name = data.get("display_name") if isinstance(data, dict) else ""
    if isinstance(display_name, str) and display_name.strip():
        return display_name.split(",")[0].strip()[:120]
    return None


async def get_weather_snapshot_by_region(region: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
        geo = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": region, "count": 1, "language": "zh", "format": "json"},
            headers={"User-Agent": HTTP_USER_AGENT},
        )
        if geo.status_code >= 400:
            return {"region": region, "error": f"geocoding error: {geo.status_code}"}
        geo_data = geo.json() if geo.content else {}
        geo_rows = geo_data.get("results") if isinstance(geo_data, dict) else None
        if not isinstance(geo_rows, list) or not geo_rows:
            return {"region": region, "error": "geocoding no result"}
        top = geo_rows[0]
        lat = top.get("latitude")
        lng = top.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return {"region": region, "error": "geocoding invalid coordinates"}
        weather = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lng,
                "current": "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
                "timezone": "auto",
            },
            headers={"User-Agent": HTTP_USER_AGENT},
        )
    if weather.status_code >= 400:
        return {"region": region, "error": f"weather api error: {weather.status_code}"}
    weather_data = weather.json() if weather.content else {}
    return {
        "region": region,
        "resolved_name": top.get("name"),
        "country": top.get("country"),
        "timezone": weather_data.get("timezone"),
        "current": (weather_data.get("current") or {}),
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }


async def mcp_search_travel(
    query: str,
    region: Optional[str],
    limit: Optional[int],
    user_ai_settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"query": "", "results": [], "error": "query is required"}
    settings = user_ai_settings or {}
    region_text = (region or "").strip()
    if not region_text:
        default_region = settings.get("weather_default_region")
        if isinstance(default_region, str) and default_region.strip():
            region_text = default_region.strip()

    auto_location_enabled = bool(settings.get("auto_use_current_location", True))
    if _is_weather_query(q) and not region_text and auto_location_enabled:
        current_region = settings.get("current_region")
        if isinstance(current_region, str) and current_region.strip():
            region_text = current_region.strip()
        else:
            lat = settings.get("current_lat")
            lng = settings.get("current_lng")
            if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                resolved_region = await resolve_region_from_coordinates(float(lat), float(lng))
                if resolved_region:
                    region_text = resolved_region

    full_query = f"{q} {region_text}".strip() if region_text else q
    top_n = max(1, min(8, int(limit) if isinstance(limit, int) else MCP_TRAVEL_SEARCH_MAX_RESULTS))

    if _is_weather_query(q) and region_text:
        return await get_weather_snapshot_by_region(region_text)

    params = {
        "q": full_query,
        "format": "json",
        "no_html": "1",
        "skip_disambig": "1",
        "no_redirect": "1",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        response = await client.get("https://api.duckduckgo.com/", params=params)
    if response.status_code >= 400:
        return {
            "query": full_query,
            "results": [],
            "error": f"search api error: {response.status_code}",
        }

    data = response.json() if response.content else {}
    results: List[Dict[str, str]] = []

    abstract_text = (data.get("AbstractText") or "").strip()
    abstract_url = (data.get("AbstractURL") or "").strip()
    heading = (data.get("Heading") or "").strip()
    if abstract_text:
        results.append(
            {
                "title": heading or full_query,
                "snippet": abstract_text[:300],
                "url": abstract_url,
                "source": "duckduckgo",
            }
        )

    _flatten_duckduckgo_related_topics(data.get("RelatedTopics"), results, top_n)
    results = results[:top_n]
    return {
        "query": full_query,
        "results": results,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }


async def execute_mcp_tool(
    tool_name: str,
    arguments: Dict[str, Any],
    user_ai_settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if tool_name == "mcp_get_current_time":
        return await mcp_get_current_time(arguments.get("timezone"))
    if tool_name == "mcp_search_travel":
        return await mcp_search_travel(
            query=str(arguments.get("query") or ""),
            region=str(arguments.get("region") or "") or None,
            limit=arguments.get("limit"),
            user_ai_settings=user_ai_settings,
        )
    return {"error": f"unsupported tool: {tool_name}"}


async def resolve_mcp_tool_context(
    client: httpx.AsyncClient,
    model: str,
    base_messages: List[Dict[str, Any]],
    default_city: Optional[str],
    user_ai_settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not ENABLE_MCP_TOOLS:
        return {"messages": base_messages, "used_tools": False, "direct_reply": ""}

    working_messages = list(base_messages)
    used_tools = False
    direct_reply = ""
    tool_summaries: List[Dict[str, Any]] = []

    for _ in range(2):
        tool_policy = user_ai_settings.get("tool_policy_json") if isinstance(user_ai_settings, dict) else {}
        if isinstance(tool_policy, dict) and tool_policy.get("enabled") is False:
            return {"messages": base_messages, "used_tools": False, "direct_reply": ""}
        planner_response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": model,
                "stream": False,
                "messages": working_messages,
                "tools": get_mcp_tool_definitions(),
                "options": {"temperature": 0.2, "num_predict": 800},
            },
        )
        if planner_response.status_code >= 400:
            return {"messages": base_messages, "used_tools": False, "direct_reply": ""}

        planner_data = planner_response.json()
        assistant_message = (planner_data.get("message") or {}) if isinstance(planner_data, dict) else {}
        tool_calls = extract_ollama_tool_calls(assistant_message)
        if not tool_calls:
            direct_reply = (assistant_message.get("content") or "").strip()
            return {
                "messages": working_messages,
                "used_tools": used_tools,
                "direct_reply": direct_reply,
            }

        used_tools = True
        for tool_call in tool_calls[:3]:
            name = tool_call["name"]
            args = dict(tool_call["arguments"])
            if name == "mcp_search_travel" and not args.get("region") and default_city:
                args["region"] = default_city
            tool_result = await execute_mcp_tool(name, args, user_ai_settings)
            tool_summaries.append(
                {
                    "tool": name,
                    "arguments": args,
                    "result": tool_result,
                }
            )

        working_messages.append(
            {
                "role": "system",
                "content": (
                    "以下是 MCP 工具查詢結果（JSON）。請整合後回覆使用者，並標註可能會隨時間變動的資訊：\n"
                    + json.dumps(tool_summaries[-len(tool_calls[:3]) :], ensure_ascii=False)
                ),
            }
        )

    return {"messages": working_messages, "used_tools": used_tools, "direct_reply": direct_reply}


async def search_segments_internal(
    query: str,
    city: Optional[str],
    limit: int,
    embedding_model: Optional[str],
) -> Dict[str, Any]:
    keyword = query.strip().lower()

    embedding = await embedding_from_ollama(query, embedding_model)
    if embedding:
        vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"
        candidate_limit = min(200, max(limit * 6, limit))
        if city:
            rows = fetch_all(
                """
                SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                       v.title AS video_title,
                       COALESCE(place_meta.place_names, '') AS place_names,
                       (s.embedding_vector <-> %s::vector) AS distance
                FROM segments s
                JOIN videos v ON v.id = s.video_id
                LEFT JOIN LATERAL (
                    SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                    FROM segment_places sp
                    JOIN places p ON p.id = sp.place_id
                    WHERE sp.segment_id = s.id
                ) AS place_meta ON TRUE
                WHERE embedding_vector IS NOT NULL
                  AND s.city = %s
                ORDER BY s.embedding_vector <-> %s::vector
                LIMIT %s
                """,
                (vector_literal, city, vector_literal, candidate_limit),
            )
        else:
            rows = fetch_all(
                """
                SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                       v.title AS video_title,
                       COALESCE(place_meta.place_names, '') AS place_names,
                       (s.embedding_vector <-> %s::vector) AS distance
                FROM segments s
                JOIN videos v ON v.id = s.video_id
                LEFT JOIN LATERAL (
                    SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                    FROM segment_places sp
                    JOIN places p ON p.id = sp.place_id
                    WHERE sp.segment_id = s.id
                ) AS place_meta ON TRUE
                WHERE s.embedding_vector IS NOT NULL
                ORDER BY s.embedding_vector <-> %s::vector
                LIMIT %s
                """,
                (vector_literal, vector_literal, candidate_limit),
            )

        if keyword:
            for row in rows:
                summary_text = (row.get("summary") or "").lower()
                tags_text = json.dumps(row.get("tags") or {}, ensure_ascii=False).lower()
                place_names = (row.get("place_names") or "").lower()
                video_title = (row.get("video_title") or "").lower()
                distance = float(row.get("distance") or 0.0)

                bonus = 0.0
                if keyword in summary_text or keyword in tags_text or keyword in video_title:
                    bonus += 1.1
                if keyword in place_names:
                    bonus += 1.8
                if place_names and any(part and part in place_names for part in query.split()):
                    bonus += 0.4

                row["_rank_score"] = bonus - distance

            rows.sort(key=lambda x: (x.get("_rank_score", 0.0), x.get("created_at")), reverse=True)
            rows = rows[:limit]
            for row in rows:
                row.pop("_rank_score", None)
        else:
            rows = rows[:limit]

        return {"mode": "pgvector+keyword-rerank", "items": rows}

    like_keyword = f"%{query}%"
    if city:
        rows = fetch_all(
            """
            SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                   v.title AS video_title,
                   COALESCE(place_meta.place_names, '') AS place_names
            FROM segments s
            JOIN videos v ON v.id = s.video_id
            LEFT JOIN LATERAL (
                SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                FROM segment_places sp
                JOIN places p ON p.id = sp.place_id
                WHERE sp.segment_id = s.id
            ) AS place_meta ON TRUE
            WHERE s.city = %s
              AND (s.summary ILIKE %s OR s.tags::text ILIKE %s OR v.title ILIKE %s OR place_meta.place_names ILIKE %s)
            ORDER BY
              CASE
                WHEN place_meta.place_names ILIKE %s THEN 0
                WHEN s.summary ILIKE %s THEN 1
                WHEN v.title ILIKE %s THEN 2
                ELSE 3
              END,
              s.created_at DESC
            LIMIT %s
            """,
            (city, like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, limit),
        )
    else:
        rows = fetch_all(
            """
            SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                   v.title AS video_title,
                   COALESCE(place_meta.place_names, '') AS place_names
            FROM segments s
            JOIN videos v ON v.id = s.video_id
            LEFT JOIN LATERAL (
                SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                FROM segment_places sp
                JOIN places p ON p.id = sp.place_id
                WHERE sp.segment_id = s.id
            ) AS place_meta ON TRUE
            WHERE s.summary ILIKE %s OR s.tags::text ILIKE %s OR v.title ILIKE %s OR place_meta.place_names ILIKE %s
            ORDER BY
              CASE
                WHEN place_meta.place_names ILIKE %s THEN 0
                WHEN s.summary ILIKE %s THEN 1
                WHEN v.title ILIKE %s THEN 2
                ELSE 3
              END,
              s.created_at DESC
            LIMIT %s
            """,
            (like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, like_keyword, limit),
        )
    return {"mode": "text-fallback", "items": rows}


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


@app.get("/api/videos")
def get_videos(
    city: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
) -> List[Dict[str, Any]]:
    if city:
        return fetch_all(
            """
            SELECT id, youtube_id, title, channel, duration, view_count, like_count, city, created_at
            FROM videos
            WHERE city = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (city, limit),
        )
    return fetch_all(
        """
        SELECT id, youtube_id, title, channel, duration, view_count, like_count, city, created_at
        FROM videos
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )


@app.get("/api/videos/{video_id}/segments")
def get_video_segments(video_id: int) -> List[Dict[str, Any]]:
    return fetch_all(
        """
        SELECT id, video_id, start_sec, end_sec, summary, tags, city, created_at
        FROM segments
        WHERE video_id = %s
        ORDER BY start_sec ASC
        """,
        (video_id,),
    )


@app.get("/api/segments/{segment_id}")
def get_segment(segment_id: int) -> Dict[str, Any]:
    segment = fetch_one(
        """
        SELECT id, video_id, start_sec, end_sec, summary, tags, city, created_at
        FROM segments
        WHERE id = %s
        """,
        (segment_id,),
    )
    if not segment:
        raise HTTPException(status_code=404, detail="segment not found")
    return segment


@app.post("/api/tools/plan-itinerary")
def plan_itinerary(payload: PlanItineraryRequest, request: Request, x_internal_token: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)

    features = build_user_features(payload.user_id)
    constraints = PlannerConstraints(
        budget_total=payload.budget_total,
        budget_per_day=payload.budget_per_day,
        pace=features.pace_pref if features else "",
        transport_pref=features.transport_pref if features else "",
        must_visit=payload.must_visit,
        avoid=(payload.avoid + (features.constraints if features else [])),
        dietary=features.dietary_pref if features else "",
        google_maps_api_key=GOOGLE_MAPS_API_KEY,
    )

    result = plan_itinerary_v2(
        segments=payload.segments,
        days_count=payload.days,
        constraints=constraints,
        preferences=payload.preferences,
    )
    response = planner_result_to_response(result)
    response["preferences"] = payload.preferences
    return response


@app.post("/api/tools/search-segments")
async def search_segments(payload: SearchSegmentsRequest, request: Request, x_internal_token: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    return await search_segments_internal(payload.query, payload.city, payload.limit, payload.embedding_model)


@app.post("/api/chat")
async def chat(
    payload: ChatRequest,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
):
    require_internal_caller(request, x_internal_token)
    trace_id = x_trace_id or payload.trace_id or ""
    chat_start = time.monotonic()
    model = payload.model or OLLAMA_MODEL
    safe_history = [m for m in payload.messages if m.content.strip()]
    if not safe_history or safe_history[-1].content != payload.message:
        safe_history.append(ChatMessage(role="user", content=payload.message))
    try:
        await maybe_extract_and_store_preferences(payload.user_id, safe_history)
    except Exception:
        # 偏好抽取失敗不應阻斷主聊天流程
        pass

    rag = await search_segments_internal(
        query=payload.message,
        city=payload.city,
        limit=5,
        embedding_model=None,
    )
    rag_items = rag.get("items") or []
    rag_context = build_rag_context(rag_items)
    user_profile_context = build_user_profile_context(payload.user_id)
    user_ai_settings = get_user_ai_settings(payload.user_id)
    preference_hits = await retrieve_user_preferences(payload.user_id, payload.message, limit=5, similarity_threshold=0.8)
    recommended_videos = await get_recommended_videos(payload.message, payload.city, payload.user_id, limit=5)

    system_text = "你是 AIYO 旅遊助理。請全程使用繁體中文回覆，並避免使用簡體中文。"
    tool_policy = user_ai_settings.get("tool_policy_json") if isinstance(user_ai_settings, dict) else {}
    custom_tool_rules = ""
    if isinstance(tool_policy, dict):
        custom_tool_rules = str(tool_policy.get("tool_trigger_rules") or "").strip()
    system_text += (
        "\n\n工具規則：你可以使用 MCP 工具來查詢即時資料。"
        "當使用者詢問即時時間、景點營業時間、交通、票價、活動或其他時效性旅遊資訊時，"
        "優先呼叫工具再回答；若工具回傳不足，需明確告知不確定處。"
    )
    if custom_tool_rules:
        system_text += f"\n\n使用者自訂工具規則：{custom_tool_rules}"
    if user_profile_context:
        system_text += (
            "\n\n以下是使用者的短期與長期記憶資料，請優先用於個人化建議：\n"
            f"{user_profile_context}\n"
            "請主動使用這些記憶辨識使用者身分、偏好、去過地點與限制，並在規劃中延續。"
        )
    if preference_hits:
        compact_preferences = [
            {
                "distance": round(float(item.get("distance") or 0.0), 4),
                "updated_at": str(item.get("updated_at") or ""),
                "preferences": item.get("preferences_json") or {},
            }
            for item in preference_hits[:5]
        ]
        system_text += (
            "\n\n以下是語意檢索到的長期偏好（最多 5 筆，threshold=0.8）：\n"
            f"{json.dumps(compact_preferences, ensure_ascii=False)}\n"
            "請優先用這些偏好做行程與影片建議，若彼此衝突，優先採用更新時間較新的偏好。"
        )
    if rag_context:
        system_text += (
            "\n\n以下是從影片片段檢索出的相關內容，請優先參考：\n"
            f"{rag_context}\n\n"
            "請基於上述內容回答，若內容不足請明確說明不確定。"
        )

    messages = [
        {
            "role": "system",
            "content": system_text,
        },
        *[m.model_dump() for m in safe_history[-20:]],
    ]

    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
        default_region = payload.city
        if not default_region and isinstance(user_ai_settings, dict):
            weather_default_region = user_ai_settings.get("weather_default_region")
            if isinstance(weather_default_region, str) and weather_default_region.strip():
                default_region = weather_default_region.strip()
        tool_flags = {
            "weather": ENABLE_WEATHER_TOOL,
            "youtube": ENABLE_YOUTUBE_TOOL,
            "transport": ENABLE_TRANSPORT_TOOL,
            "travel_info": ENABLE_TRAVEL_INFO_TOOL,
        }
        tool_policy = user_ai_settings.get("tool_policy_json") if isinstance(user_ai_settings, dict) else {}
        context = {
            "default_timezone": MCP_DEFAULT_TIMEZONE,
            "default_region": default_region,
            "user_ai_settings": user_ai_settings,
            "tool_policy_json": tool_policy if isinstance(tool_policy, dict) else {},
            "http_user_agent": HTTP_USER_AGENT,
            "youtube_api_key": YOUTUBE_API_KEY,
            "last_user_message": payload.message,
            "max_default_search_results": MCP_TRAVEL_SEARCH_MAX_RESULTS,
        }
        resolved = await resolve_tool_context(
            client=client,
            ollama_base_url=OLLAMA_BASE_URL,
            model=model,
            base_messages=messages,
            context=context,
            tool_flags=tool_flags,
            max_rounds=TOOL_AGENT_MAX_ROUNDS,
            max_calls_per_round=TOOL_AGENT_MAX_CALLS_PER_ROUND,
        )
        final_messages = resolved["messages"] if isinstance(resolved.get("messages"), list) else messages
        used_mcp_tools = bool(resolved.get("used_tools"))
        direct_reply = str(resolved.get("direct_reply") or "").strip()
        tool_calls_summary = resolved.get("tool_calls_summary") if isinstance(resolved.get("tool_calls_summary"), list) else []

        if payload.stream:
            if direct_reply and not used_mcp_tools:
                async def direct_event_stream():
                    yield f"data: {json.dumps({'token': direct_reply}, ensure_ascii=False)}\n\n"
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "done": True,
                                "recommended_videos": recommended_videos,
                                "used_mcp_tools": False,
                                "tool_calls_summary": tool_calls_summary,
                            },
                            ensure_ascii=False,
                        )
                        + "\n\n"
                    )
                    write_audit_log(
                        trace_id=trace_id, user_id=payload.user_id, session_id=payload.session_id,
                        endpoint="/api/chat", method="POST", status_code=200,
                        request_json={"message": payload.message, "model": model, "city": payload.city, "stream": True},
                        response_json={"reply_length": len(direct_reply), "direct": True},
                        tool_calls_json=tool_calls_summary,
                        duration_ms=int((time.monotonic() - chat_start) * 1000),
                    )

                return StreamingResponse(direct_event_stream(), media_type="text/event-stream")

            upstream = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={"model": model, "stream": True, "messages": final_messages},
            )
            if upstream.status_code >= 400:
                write_audit_log(
                    trace_id=trace_id, user_id=payload.user_id, session_id=payload.session_id,
                    endpoint="/api/chat", method="POST", status_code=502,
                    request_json={"message": payload.message, "model": model},
                    error_text=f"ollama error: {upstream.status_code}",
                    duration_ms=int((time.monotonic() - chat_start) * 1000),
                )
                return JSONResponse(
                    {"error": f"ollama error: {upstream.status_code}", "detail": upstream.text},
                    status_code=502,
                )

            async def event_stream():
                collected_text = ""
                async for raw in upstream.aiter_lines():
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        yield f"data: {json.dumps({'error': chunk['error']}, ensure_ascii=False)}\n\n"
                        continue
                    token = (chunk.get("message") or {}).get("content") or ""
                    if token:
                        collected_text += token
                        yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
                    if chunk.get("done"):
                        yield (
                            "data: "
                            + json.dumps(
                                {
                                    "done": True,
                                    "recommended_videos": recommended_videos,
                                    "used_mcp_tools": used_mcp_tools,
                                    "tool_calls_summary": tool_calls_summary,
                                },
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                write_audit_log(
                    trace_id=trace_id, user_id=payload.user_id, session_id=payload.session_id,
                    endpoint="/api/chat", method="POST", status_code=200,
                    request_json={"message": payload.message, "model": model, "city": payload.city, "stream": True},
                    response_json={"reply_length": len(collected_text)},
                    ai_prompt_json={"system_text_length": len(system_text), "messages_count": len(final_messages)},
                    tool_calls_json=tool_calls_summary,
                    duration_ms=int((time.monotonic() - chat_start) * 1000),
                )

            return StreamingResponse(event_stream(), media_type="text/event-stream")

        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={"model": model, "stream": False, "messages": final_messages},
        )
        if response.status_code >= 400:
            elapsed = int((time.monotonic() - chat_start) * 1000)
            write_audit_log(
                trace_id=trace_id, user_id=payload.user_id, session_id=payload.session_id,
                endpoint="/api/chat", method="POST", status_code=502,
                request_json={"message": payload.message, "model": model},
                error_text=f"ollama error: {response.status_code}",
                duration_ms=elapsed,
            )
            raise HTTPException(status_code=502, detail=f"ollama error: {response.status_code}")
        data = response.json()
        text = (data.get("message") or {}).get("content") or ""
        elapsed = int((time.monotonic() - chat_start) * 1000)
        write_audit_log(
            trace_id=trace_id, user_id=payload.user_id, session_id=payload.session_id,
            endpoint="/api/chat", method="POST", status_code=200,
            request_json={"message": payload.message, "model": model, "city": payload.city},
            response_json={"reply_length": len(text)},
            ai_prompt_json={"system_text_length": len(system_text), "messages_count": len(final_messages)},
            ai_response_json={"text_length": len(text)},
            tool_calls_json=tool_calls_summary,
            duration_ms=elapsed,
        )
        return {
            "reply": text,
            "recommended_videos": recommended_videos,
            "used_mcp_tools": used_mcp_tools,
            "tool_calls_summary": tool_calls_summary,
        }
