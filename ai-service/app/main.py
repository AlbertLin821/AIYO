from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo

import httpx

# 載入 .env：先 ai-service 目錄，再專案根目錄（與 .env.example 同層）
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent
    load_dotenv(_root / ".env")
    load_dotenv(_root.parent / ".env")
except ImportError:
    pass
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
from app.v2_router import router as v2_router


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
    itinerary_places: Optional[List[str]] = None


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


class RecommendationMoreRequest(BaseModel):
    user_id: Optional[int] = None
    exclude_youtube_ids: List[str] = Field(default_factory=list)
    last_query: str = ""
    city: Optional[str] = None
    limit: int = Field(default=5, ge=1, le=20)


class PreviewVideoOutlineRequest(BaseModel):
    """資料庫尚無影片列時，僅依標題／描述產生摘要（供前端降級）。"""
    title: str = Field(min_length=1)
    city: str = ""
    description: str = ""
    youtube_id: str = ""


class PreferenceExtractResult(BaseModel):
    budget: Optional[str] = None
    budget_per_person: Optional[str] = None
    travel_likes: List[str] = Field(default_factory=list)
    video_likes: List[str] = Field(default_factory=list)
    pace: Optional[str] = None
    transport: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    preferred_cities: List[str] = Field(default_factory=list)
    must_visit: List[str] = Field(default_factory=list)
    must_avoid: List[str] = Field(default_factory=list)
    travel_type: Optional[str] = None
    group_composition: Optional[str] = None
    accommodation_level: Optional[str] = None
    flight_preference: Optional[str] = None
    dietary_restrictions: List[str] = Field(default_factory=list)
    accessibility_needs: List[str] = Field(default_factory=list)


def get_env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


DATABASE_URL = get_env("DATABASE_URL", "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db")
OLLAMA_BASE_URL = get_env("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = get_env("OLLAMA_MODEL", "gemma4:e4b")
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

# 聊天串流：connect 有限、read 拉長，避免長回應在固定秒數被整段切斷
CHAT_HTTP_TIMEOUT = httpx.Timeout(connect=30.0, read=600.0, write=120.0, pool=30.0)

_ITINERARY_INTENT_RE = re.compile(
    r"(完整行程|幫我排|排行程|行程規劃|旅遊行程|規劃行程|行程表|套裝行程|幫我安排|安排行程|加入.*行程|放進.*行程|加到.*行程|右邊.*行程)",
    re.I,
)


def _ollama_chat_options() -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "num_predict": max(256, min(131072, int(get_env("OLLAMA_NUM_PREDICT_CHAT", "8192")))),
    }
    ctx_raw = (os.getenv("OLLAMA_NUM_CTX_CHAT") or "").strip()
    if ctx_raw:
        try:
            opts["num_ctx"] = max(512, min(262144, int(ctx_raw)))
        except ValueError:
            pass
    return opts


def _parse_trip_days_from_message(text: str) -> Optional[int]:
    if not text:
        return None
    m = re.search(r"(\d+)\s*天", text)
    if m:
        return int(m.group(1))
    cn_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    for ch, n in cn_map.items():
        if f"{ch}天" in text:
            return n
    return None


def _user_requests_structured_itinerary(user_message: str, conv_ctx: Dict[str, Any]) -> bool:
    """使用者是否表達要產出可排進模板的結構化行程（與 RAG 是否有資料無關）。"""
    msg = (user_message or "").strip()
    if _ITINERARY_INTENT_RE.search(msg):
        return True
    if re.search(r"\d+\s*天", msg):
        return True
    if _parse_trip_days_from_message(msg) is not None:
        return True
    if re.search(r"[一二三四五六七八九十]\s*天", msg):
        return True
    if re.search(r"\d+\s*天\s*\d+\s*夜", msg) or re.search(
        r"[一二三四五六七八九十]天[一二三四五六七八九十]夜", msg
    ):
        return True
    for topic in conv_ctx.get("topics") or []:
        if isinstance(topic, str) and "行程" in topic:
            return True
    return False


def _should_emit_itinerary_plan(
    user_message: str,
    conv_ctx: Dict[str, Any],
    segments: List[Dict[str, Any]],
) -> bool:
    if not segments:
        return False
    return _user_requests_structured_itinerary(user_message, conv_ctx)


def _split_place_names(raw: str) -> List[str]:
    if not raw or not str(raw).strip():
        return []
    parts = re.split(r"[\s,，、]+", str(raw).strip())
    return [p.strip() for p in parts if p.strip()]


def _segments_from_conv_ctx_places(conv_ctx: Dict[str, Any], limit: int = 18) -> List[Dict[str, Any]]:
    raw = conv_ctx.get("place_names")
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for item in raw:
        name = _normalize_destination_token(str(item or "").strip())
        if not name:
            continue
        k = name.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(
            {
                "place_name": name,
                "segment_id": None,
                "place_id": None,
                "lat": None,
                "lng": None,
                "stay_minutes": 60,
                "estimated_cost": 0.0,
            }
        )
        if len(out) >= limit:
            break
    return out


def _fetch_places_for_segment(segment_id: int) -> List[Dict[str, Any]]:
    return fetch_all(
        """
        SELECT p.id, p.name, p.lat, p.lng
        FROM segment_places sp
        JOIN places p ON p.id = sp.place_id
        WHERE sp.segment_id = %s
        ORDER BY p.id ASC
        """,
        (segment_id,),
    )


def _segment_dict_for_place_name(segment_id: int, place_name: str) -> Dict[str, Any]:
    rows = _fetch_places_for_segment(segment_id)
    target = place_name.strip().lower()
    chosen: Optional[Dict[str, Any]] = None
    for row in rows:
        if (row.get("name") or "").strip().lower() == target:
            chosen = row
            break
    if chosen is None and rows:
        chosen = rows[0]
    if chosen is None:
        return {
            "place_name": place_name,
            "segment_id": segment_id,
            "place_id": None,
            "lat": None,
            "lng": None,
            "stay_minutes": 60,
            "estimated_cost": 0.0,
        }
    lat = chosen.get("lat")
    lng = chosen.get("lng")
    pid = chosen.get("id")
    return {
        "place_name": place_name,
        "segment_id": segment_id,
        "place_id": int(pid) if pid is not None else None,
        "lat": float(lat) if isinstance(lat, (int, float)) else None,
        "lng": float(lng) if isinstance(lng, (int, float)) else None,
        "stay_minutes": 60,
        "estimated_cost": 0.0,
    }


def build_planner_segments_from_rag_and_places(
    rag_items: List[Dict[str, Any]],
    itinerary_places: Optional[List[str]],
) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for raw in itinerary_places or []:
        name = _normalize_destination_token((raw or "").strip())
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "place_name": name,
                "segment_id": None,
                "place_id": None,
                "lat": None,
                "lng": None,
                "stay_minutes": 60,
                "estimated_cost": 0.0,
            }
        )
    for item in rag_items:
        sid = item.get("id")
        if sid is None:
            continue
        try:
            seg_id = int(sid)
        except (TypeError, ValueError):
            continue
        names = _split_place_names(str(item.get("place_names") or ""))
        if not names:
            summary = (item.get("summary") or "").strip()
            if summary:
                first = summary.split("\n")[0].strip()
                if (
                    first
                    and len(first) <= 48
                    and "。" not in first
                    and "\n" not in first
                ):
                    names = [first[:120]]
        if not names:
            video_title = (item.get("video_title") or item.get("title") or "").strip()
            if video_title:
                head = re.split(r"[|｜\-—:：,，、]", video_title)[0].strip()
                if head and 2 <= len(head) <= 36:
                    names = [head]
        for name in names:
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(_segment_dict_for_place_name(seg_id, name))
    return out


def _merge_rag_items(primary: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Set[int] = set()
    out: List[Dict[str, Any]] = []
    for row in primary + extra:
        rid = row.get("id")
        if rid is None:
            continue
        try:
            key = int(rid)
        except (TypeError, ValueError):
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def _synthetic_planner_segments(conv_ctx: Dict[str, Any], payload: ChatRequest) -> List[Dict[str, Any]]:
    """不再產生城市占位景點，避免出現不真實與重複的假行程。"""
    return []


def _expand_segments_for_days(
    segments: List[Dict[str, Any]],
    days_count: int,
    slots_per_day: int,
) -> List[Dict[str, Any]]:
    """保留真實來源景點，不為了填滿天數而重複灌入相同景點。"""
    if not segments or days_count <= 0 or slots_per_day <= 0:
        return segments
    need = min(days_count * slots_per_day, 48)
    return segments[:need]


def _slots_per_day_from_pace(pace: str) -> int:
    if pace in ("慢", "輕鬆"):
        return 3
    if pace in ("快", "緊湊"):
        return 6
    return 4


def build_chat_itinerary_plan_if_applicable(
    payload: ChatRequest,
    conv_ctx: Dict[str, Any],
    rag_items: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    segments = build_planner_segments_from_rag_and_places(rag_items, payload.itinerary_places)
    if not segments:
        segments = _segments_from_conv_ctx_places(conv_ctx)
    if not segments:
        segments = _synthetic_planner_segments(conv_ctx, payload)
    if not segments or not _should_emit_itinerary_plan(payload.message, conv_ctx, segments):
        return None
    days = _parse_trip_days_from_message(payload.message)
    extra_warnings: List[str] = []
    if days is None:
        days = 3
        extra_warnings.append("未能從訊息解析天數，預設使用 3 天")
    else:
        days = min(14, max(1, days))
    features = build_user_features(payload.user_id)
    avoid_list: List[str] = []
    if features:
        avoid_list.extend(features.constraints)
    constraints = PlannerConstraints(
        budget_total=None,
        budget_per_day=None,
        pace=features.pace_pref if features else "",
        transport_pref=features.transport_pref if features else "",
        must_visit=[],
        avoid=avoid_list,
        dietary=features.dietary_pref if features else "",
        google_maps_api_key=GOOGLE_MAPS_API_KEY,
    )
    preferences: List[str] = []
    if features:
        if features.travel_style:
            preferences.append(features.travel_style)
        if features.budget_pref:
            preferences.append(features.budget_pref)
    pace_str = features.pace_pref if features else ""
    slots_per = _slots_per_day_from_pace(pace_str)
    segments = _expand_segments_for_days(segments, days, slots_per)
    capacity = max(1, days * max(1, slots_per))
    if len(segments) < capacity:
        extra_warnings.append(
            f"目前可用的真實景點資料較少（{len(segments)} 筆），已採精簡行程避免重複與虛構景點。"
        )
    result = plan_itinerary_v2(
        segments=segments,
        days_count=days,
        constraints=constraints,
        preferences=preferences,
    )
    response = planner_result_to_response(result)
    if extra_warnings:
        w = list(response.get("warnings") or [])
        w.extend(extra_warnings)
        response["warnings"] = w
    return response


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
app.include_router(v2_router)


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


@lru_cache(maxsize=8)
def get_vector_column_dim(table_name: str, column_name: str) -> Optional[int]:
    row = fetch_one(
        """
        SELECT format_type(a.atttypid, a.atttypmod) AS type
        FROM pg_attribute a
        WHERE a.attrelid = %s::regclass
          AND a.attname = %s
          AND a.attnum > 0
          AND NOT a.attisdropped
        """,
        (table_name, column_name),
    )
    vector_type = (row or {}).get("type")
    if not vector_type:
        return None
    match = re.search(r"vector\((\d+)\)", str(vector_type))
    if not match:
        return None
    return int(match.group(1))


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
        "\"budget_per_person\": \"\", "
        "\"travel_likes\": [], "
        "\"video_likes\": [], "
        "\"pace\": \"\", "
        "\"transport\": \"\", "
        "\"constraints\": [], "
        "\"preferred_cities\": [], "
        "\"must_visit\": [], "
        "\"must_avoid\": [], "
        "\"travel_type\": \"\", "
        "\"group_composition\": \"\", "
        "\"accommodation_level\": \"\", "
        "\"flight_preference\": \"\", "
        "\"dietary_restrictions\": [], "
        "\"accessibility_needs\": []"
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
        budget_per_person=(model.budget_per_person or "").strip() or None,
        travel_likes=dedup_non_empty(model.travel_likes, limit=10),
        video_likes=dedup_non_empty(model.video_likes, limit=8),
        pace=(model.pace or "").strip() or None,
        transport=(model.transport or "").strip() or None,
        constraints=dedup_non_empty(model.constraints, limit=10),
        preferred_cities=dedup_non_empty(model.preferred_cities, limit=10),
        must_visit=dedup_non_empty(model.must_visit, limit=12),
        must_avoid=dedup_non_empty(model.must_avoid, limit=12),
        travel_type=(model.travel_type or "").strip() or None,
        group_composition=(model.group_composition or "").strip() or None,
        accommodation_level=(model.accommodation_level or "").strip() or None,
        flight_preference=(model.flight_preference or "").strip() or None,
        dietary_restrictions=dedup_non_empty(model.dietary_restrictions, limit=10),
        accessibility_needs=dedup_non_empty(model.accessibility_needs, limit=10),
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


def _format_mm_ss(total_sec: int) -> str:
    s = max(0, int(total_sec))
    return f"{s // 60}:{s % 60:02d}"


def build_rag_context(items: List[Dict[str, Any]]) -> str:
    if not items:
        return ""
    lines = []
    for idx, item in enumerate(items, start=1):
        start = int(item.get("start_sec") or 0)
        end = int(item.get("end_sec") or 0)
        mm_start = _format_mm_ss(start)
        mm_end = _format_mm_ss(end)
        summary = (item.get("summary") or "").strip()
        tags = item.get("tags")
        tags_text = json.dumps(tags, ensure_ascii=False) if tags is not None else "[]"
        video_title = (item.get("video_title") or "").strip()
        lines.append(
            f"[片段{idx}] segment_id={item.get('id')} video_id={item.get('video_id')}\n"
            f"  影片：{video_title}\n"
            f"  時間：{mm_start} ~ {mm_end}（start_sec={start}, end_sec={end}）\n"
            f"  城市：{item.get('city') or '未知'}\n"
            f"  摘要：{summary}\n"
            f"  標籤：{tags_text}"
        )
    return "\n\n".join(lines)


HYBRID_RRF_K = 60
HYBRID_VECTOR_TOP_K = 20
HYBRID_KEYWORD_TOP_K = 20

VIDEO_SEGMENT_PRESENTATION_RULES = """

## 影片片段呈現規則
當回覆涉及旅遊地點或推薦，且下方提供「影片片段檢索結果」時，你必須遵循以下步驟：
1. 先掃描該檢索結果，找出與使用者問題最相關的片段
2. 提取該片段的 segment_id、video_id、start_sec、end_sec（秒數可對應至「時間」欄的 MM:SS）
3. 在回覆中以「影片標題（時間 MM:SS）」的格式呈現，例如：「高雄三天兩夜攻略（2:35）」
4. 若有多個相關片段，依相關性排序列出，並盡量引用摘要中的具體內容

### 好的回覆範例
使用者：高雄有什麼好吃的夜市？
回覆：高雄最推薦的夜市美食有以下幾個：
- 瑞豐夜市的臭豆腐和雞排很有人氣，詳細介紹可以看「高雄美食攻略」（3:25）
- 六合夜市的海鮮粥是必吃，在「南台灣夜市巡禮」（1:15）有實地探訪

### 不好的回覆範例
使用者：高雄有什麼好吃的夜市？
回覆：高雄有很多好吃的夜市喔，像瑞豐夜市和六合夜市都不錯。
（問題：沒有引用檢索到的影片片段、沒有時間戳、沒有對應摘要內容）
"""


def reciprocal_rank_fusion(
    vector_rows: List[Dict[str, Any]],
    keyword_rows: List[Dict[str, Any]],
    *,
    k: int = HYBRID_RRF_K,
    final_limit: int = 5,
) -> List[Dict[str, Any]]:
    """以 Reciprocal Rank Fusion 合併向量路徑與關鍵字路徑的排序結果。"""
    by_id: Dict[int, Dict[str, Any]] = {}
    scores: Dict[int, float] = {}
    for rank, row in enumerate(vector_rows):
        sid = row.get("id")
        if sid is None:
            continue
        sid = int(sid)
        if sid not in by_id:
            by_id[sid] = row
        scores[sid] = scores.get(sid, 0.0) + 1.0 / (k + rank + 1)
    for rank, row in enumerate(keyword_rows):
        sid = row.get("id")
        if sid is None:
            continue
        sid = int(sid)
        if sid not in by_id:
            by_id[sid] = row
        scores[sid] = scores.get(sid, 0.0) + 1.0 / (k + rank + 1)
    ordered_ids = sorted(scores.keys(), key=lambda i: scores[i], reverse=True)[:final_limit]
    return [by_id[i] for i in ordered_ids]


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
                  WHEN 'like' THEN 1.2
                  WHEN 'dismiss' THEN -1.2
                  WHEN 'unlike' THEN -1.0
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
                WHEN 'like' THEN 1.2
                WHEN 'dismiss' THEN -1.2
                WHEN 'unlike' THEN -1.0
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


COMMON_CITY_NAMES = [
    "台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "嘉義", "嘉義市", "苗栗",
    "彰化", "南投", "雲林", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門", "馬祖",
]

INTL_CITY_NAMES = [
    "東京", "大阪", "京都", "北海道", "沖繩", "福岡", "名古屋", "奈良", "神戶", "札幌",
    "首爾", "釜山", "濟州", "曼谷", "清邁", "普吉", "峇里島", "新加坡", "吉隆坡",
    "河內", "胡志明", "金邊", "仰光", "馬尼拉", "宿霧",
    "巴黎", "倫敦", "羅馬", "巴塞隆納", "阿姆斯特丹", "維也納", "布拉格", "柏林", "蘇黎世",
    "紐約", "洛杉磯", "舊金山", "夏威夷", "溫哥華", "多倫多", "雪梨", "墨爾本",
    "香港", "澳門", "上海", "北京",
]

ALL_CITY_NAMES = COMMON_CITY_NAMES + INTL_CITY_NAMES

# 常見旅遊區／景區關鍵字（非縣市行政名，但常出現在對話中）
EXTRA_DESTINATION_NAMES = [
    "墾丁", "恆春", "小琉球", "綠島", "蘭嶼", "九份", "十分", "淡水", "烏來",
    "清境", "日月潭", "阿里山", "太魯閣", "野柳", "北投", "陽明山", "武陵農場",
]

DESTINATION_ALIAS_MAP: Dict[str, str] = {
    "台中市": "台中",
    "台南市": "台南",
    "高雄市": "高雄",
    "台北市": "台北",
    "臺北": "台北",
    "臺中": "台中",
    "臺南": "台南",
    "錫城": "無錫",
    "无锡": "無錫",
}


def _normalize_destination_token(token: str) -> str:
    t = (token or "").strip()
    if not t:
        return ""
    return DESTINATION_ALIAS_MAP.get(t, t)


def _extract_destination_tokens(text: str) -> List[str]:
    """從對話中抽出縣市或常見旅遊區名稱（較長詞優先匹配）。"""
    if not text or not str(text).strip():
        return []
    t = str(text)
    pool = list(dict.fromkeys(list(ALL_CITY_NAMES) + list(EXTRA_DESTINATION_NAMES)))
    pool.sort(key=len, reverse=True)
    found: List[str] = []
    seen: Set[str] = set()
    for token in pool:
        if token in t:
            normalized = _normalize_destination_token(token)
            if normalized and normalized not in seen:
                seen.add(normalized)
                found.append(normalized)
    for alias, canonical in DESTINATION_ALIAS_MAP.items():
        if alias in t:
            normalized = _normalize_destination_token(canonical)
            if normalized and normalized not in seen:
                seen.add(normalized)
                found.append(normalized)
    return found


def _extract_city_from_query(query: str) -> Optional[str]:
    if not query or not query.strip():
        return None
    q = query.strip()
    for name in ALL_CITY_NAMES:
        if name in q:
            return name
    return None


def _extract_cities_from_text(text: str) -> List[str]:
    """Extract all city / destination names from text."""
    return _extract_destination_tokens(text)


TRAVEL_TOPIC_KEYWORDS = [
    "行程",
    "美食", "夜市", "小吃", "餐廳", "咖啡", "甜點",
    "景點", "古蹟", "博物館", "公園", "老街", "市場",
    "住宿", "飯店", "民宿", "旅館", "青旅",
    "交通", "地鐵", "捷運", "JR", "新幹線", "公車", "機場",
    "購物", "百貨", "伴手禮", "藥妝",
    "溫泉", "海邊", "登山", "潛水", "浮潛", "衝浪",
    "親子", "家庭", "蜜月", "自由行", "背包客",
    "櫻花", "楓葉", "花季", "祭典", "煙火",
    "預算", "省錢", "奢華", "米其林",
]


def build_conversation_context(
    current_message: str,
    messages: List[ChatMessage],
    itinerary_places: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Analyze the full conversation to build a rich context for search queries.

    Returns dict with:
      - enhanced_query: a richer query string combining current message + context
      - mentioned_cities: all cities mentioned across the conversation
      - topics: travel topics detected in conversation
      - itinerary_cities: cities extracted from itinerary places
    """
    all_cities: List[str] = []
    all_topics: List[str] = []

    recent_messages = messages[-10:] if len(messages) > 10 else messages
    conversation_text = " ".join(
        m.content for m in recent_messages if m.role in ("user", "assistant") and m.content
    )
    conversation_text += " " + current_message

    for city in ALL_CITY_NAMES:
        if city in conversation_text:
            all_cities.append(city)
    for spot in EXTRA_DESTINATION_NAMES:
        if spot in conversation_text and spot not in all_cities:
            all_cities.append(spot)

    for kw in TRAVEL_TOPIC_KEYWORDS:
        if kw in conversation_text:
            all_topics.append(kw)

    itinerary_cities: List[str] = []
    if itinerary_places:
        itin_text = " ".join(itinerary_places)
        for city in ALL_CITY_NAMES:
            if city in itin_text:
                itinerary_cities.append(city)

    current_cities = _extract_cities_from_text(current_message)
    current_topics = [kw for kw in TRAVEL_TOPIC_KEYWORDS if kw in current_message]

    query_parts = [current_message]

    context_cities = [c for c in all_cities if c not in (current_cities or [])]
    if context_cities:
        query_parts.append(" ".join(context_cities[:3]))

    if itinerary_cities:
        extra_itin = [c for c in itinerary_cities if c not in (current_cities or []) and c not in context_cities]
        if extra_itin:
            query_parts.append(" ".join(extra_itin[:2]))

    context_topics = [t for t in all_topics if t not in (current_topics or [])]
    if context_topics and not current_topics:
        query_parts.append(" ".join(context_topics[:2]))

    enhanced_query = " ".join(query_parts)
    if len(enhanced_query) > 300:
        enhanced_query = enhanced_query[:300]

    place_names: List[str] = []
    if itinerary_places:
        place_names = list(
            dict.fromkeys(
                p.strip()
                for p in itinerary_places
                if isinstance(p, str) and len(p.strip()) >= 2
            )
        )
    for token in _extract_destination_tokens(conversation_text):
        if token not in place_names:
            place_names.append(token)

    return {
        "enhanced_query": enhanced_query,
        "mentioned_cities": list(dict.fromkeys(all_cities)),
        "topics": list(dict.fromkeys(all_topics)),
        "itinerary_cities": list(dict.fromkeys(itinerary_cities)),
        "all_relevant_cities": list(dict.fromkeys(
            (current_cities or []) + all_cities + itinerary_cities
        )),
        "place_names": place_names,
    }


def _attach_db_video_ids(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """將僅來自 YouTube API 的假 video_id 換成資料庫真實 id（若該 youtube_id 已入庫）。"""
    yids = [str(r.get("youtube_id") or "").strip() for r in rows if (r.get("youtube_id") or "").strip()]
    if not yids:
        return rows
    unique = list(dict.fromkeys(yids))
    placeholders = ",".join(["%s"] * len(unique))
    db_rows = fetch_all(
        f"SELECT id, youtube_id FROM videos WHERE youtube_id IN ({placeholders})",
        tuple(unique),
    )
    y2id: Dict[str, int] = {}
    for row in db_rows:
        yk = str(row.get("youtube_id") or "").strip()
        rid = row.get("id")
        if yk and rid is not None:
            y2id[yk] = int(rid)
    for r in rows:
        yid = str(r.get("youtube_id") or "").strip()
        if yid and yid in y2id:
            r["video_id"] = y2id[yid]
    return rows


async def get_recommended_videos(
    query: str,
    city: Optional[str],
    user_id: Optional[int],
    limit: int = 5,
    exclude_youtube_ids: Optional[List[str]] = None,
    conversation_context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    features = build_user_features(user_id)
    scoring_ctx = features_to_scoring_context(features) if features else {
        "keywords": [], "preferred_cities": set(), "budget_pref": "",
        "pace_pref": "", "transport_pref": "", "dietary_pref": "",
        "constraints": [], "current_region": "",
    }

    ctx = conversation_context or {}
    enhanced_query = ctx.get("enhanced_query") or query
    context_cities = ctx.get("all_relevant_cities") or []
    context_topics = ctx.get("topics") or []
    raw_place_names = ctx.get("place_names")
    place_names_for_rerank: List[str] = []
    if isinstance(raw_place_names, list):
        place_names_for_rerank = list(
            dict.fromkeys(str(x).strip() for x in raw_place_names if str(x).strip() and len(str(x).strip()) >= 2)
        )
    strict_place_match = len(place_names_for_rerank) > 0

    if context_topics:
        merged_keywords = list(dict.fromkeys(list(scoring_ctx["keywords"]) + context_topics))
        scoring_ctx["keywords"] = merged_keywords

    if context_cities:
        merged_pref_cities = set(scoring_ctx["preferred_cities"]) | set(context_cities)
        scoring_ctx["preferred_cities"] = merged_pref_cities

    effective_city = city or _extract_city_from_query(query)
    city_filter = ""
    params: List[Any] = []
    if effective_city:
        city_filter = "AND s.city = %s"
        params.append(effective_city)

    search_query = enhanced_query if len(enhanced_query) <= 200 else query
    like_pat = f"%{search_query}%"
    params.extend([like_pat, like_pat, like_pat, like_pat])

    db_rows = fetch_all(
        f"""
        SELECT s.id AS segment_id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
               v.youtube_id, v.title, v.channel, v.duration,
               COALESCE(place_meta.place_names, '') AS place_names
        FROM segments s
        JOIN videos v ON v.id = s.video_id
        LEFT JOIN LATERAL (
            SELECT string_agg(DISTINCT p.name, ' ') AS place_names
            FROM segment_places sp
            JOIN places p ON p.id = sp.place_id
            WHERE sp.segment_id = s.id
        ) AS place_meta ON TRUE
        WHERE (s.summary ILIKE %s OR s.tags::text ILIKE %s OR v.title ILIKE %s
               OR COALESCE(place_meta.place_names, '') ILIKE %s)
          {city_filter}
        ORDER BY s.created_at DESC
        LIMIT 80
        """,
        tuple(params[-4:] + params[:-4]) if effective_city else tuple(params),
    )

    candidates = build_candidates_from_db_rows(db_rows)

    if len(candidates) < 15 and search_query != query:
        fallback_params: List[Any] = []
        fb_city_filter = ""
        if effective_city:
            fb_city_filter = "AND s.city = %s"
            fallback_params.append(effective_city)
        fb_like = f"%{query}%"
        fallback_params.extend([fb_like, fb_like, fb_like, fb_like])
        fallback_rows = fetch_all(
            f"""
            SELECT s.id AS segment_id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                   v.youtube_id, v.title, v.channel, v.duration,
                   COALESCE(place_meta.place_names, '') AS place_names
            FROM segments s
            JOIN videos v ON v.id = s.video_id
            LEFT JOIN LATERAL (
                SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                FROM segment_places sp
                JOIN places p ON p.id = sp.place_id
                WHERE sp.segment_id = s.id
            ) AS place_meta ON TRUE
            WHERE (s.summary ILIKE %s OR s.tags::text ILIKE %s OR v.title ILIKE %s
                   OR COALESCE(place_meta.place_names, '') ILIKE %s)
              {fb_city_filter}
            ORDER BY s.created_at DESC
            LIMIT 40
            """,
            tuple(fallback_params[-4:] + fallback_params[:-4]) if effective_city else tuple(fallback_params),
        )
        existing_seg_ids = {c.video_id for c in candidates if c.video_id}
        for row in build_candidates_from_db_rows(fallback_rows):
            if row.video_id not in existing_seg_ids:
                candidates.append(row)
                existing_seg_ids.add(row.video_id)

    if not effective_city and context_cities:
        for conv_city in context_cities[:2]:
            city_params: List[Any] = [conv_city, f"%{conv_city}%"]
            city_rows = fetch_all(
                """
                SELECT s.id AS segment_id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                       v.youtube_id, v.title, v.channel, v.duration,
                       COALESCE(place_meta.place_names, '') AS place_names
                FROM segments s
                JOIN videos v ON v.id = s.video_id
                LEFT JOIN LATERAL (
                    SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                    FROM segment_places sp
                    JOIN places p ON p.id = sp.place_id
                    WHERE sp.segment_id = s.id
                ) AS place_meta ON TRUE
                WHERE s.city = %s OR v.title ILIKE %s
                ORDER BY s.created_at DESC
                LIMIT 20
                """,
                tuple(city_params),
            )
            existing_vid_ids = {c.video_id for c in candidates if c.video_id}
            for row in build_candidates_from_db_rows(city_rows):
                if row.video_id not in existing_vid_ids:
                    candidates.append(row)
                    existing_vid_ids.add(row.video_id)

    if YOUTUBE_API_KEY and not strict_place_match:
        yt_query = enhanced_query if len(enhanced_query) <= 120 else query
        youtube_result = await search_youtube_videos(
            query=yt_query,
            location=effective_city or (context_cities[0] if context_cities else city),
            max_results=max(limit * 2, 5),
            youtube_api_key=YOUTUBE_API_KEY,
        )
        youtube_rows: List[Dict[str, Any]] = []
        if youtube_result.get("ok"):
            data = youtube_result.get("data")
            if isinstance(data, dict) and isinstance(data.get("videos"), list):
                youtube_rows = data.get("videos") or []
        youtube_candidates = build_candidates_from_youtube_api(youtube_rows)
        yt_fill_city = effective_city or (context_cities[0] if context_cities else None)
        if youtube_candidates and yt_fill_city:
            for c in youtube_candidates:
                if not c.city or not c.city.strip():
                    c.city = yt_fill_city
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
    exclude_set = {x.strip() for x in (exclude_youtube_ids or []) if isinstance(x, str) and x.strip()}
    rerank_limit = limit + len(exclude_set) if exclude_set else limit
    scored = rerank_candidates(
        candidates=candidates,
        keywords=scoring_ctx["keywords"],
        preferred_cities=scoring_ctx["preferred_cities"],
        budget_pref=scoring_ctx["budget_pref"],
        pace_pref=scoring_ctx["pace_pref"],
        constraints=scoring_ctx["constraints"],
        interaction_scores=get_user_interaction_scores(user_id),
        query_text=enhanced_query,
        place_names=place_names_for_rerank,
        limit=min(80, max(rerank_limit, limit)),
    )
    if strict_place_match:
        matched = [r for r in scored if float((r.score_breakdown or {}).get("place_name_match") or 0.0) > 0.0]
        if matched:
            scored = matched
    if exclude_set:
        scored = [r for r in scored if (r.candidate.youtube_id or "").strip() not in exclude_set][:limit]
    else:
        scored = scored[:limit]
    if not scored and YOUTUBE_API_KEY:
        fallback_query = (effective_city or (context_cities[0] if context_cities else "")).strip()
        if fallback_query:
            fallback_query = f"{fallback_query} 旅遊"
        else:
            fallback_query = "旅遊"
        fallback_result = await search_youtube_videos(
            query=fallback_query,
            location=effective_city or (context_cities[0] if context_cities else city),
            max_results=max(limit, 5),
            youtube_api_key=YOUTUBE_API_KEY,
        )
        fallback_rows: List[Dict[str, Any]] = []
        if fallback_result.get("ok"):
            data = fallback_result.get("data")
            if isinstance(data, dict) and isinstance(data.get("videos"), list):
                fallback_rows = data.get("videos") or []
        fallback_candidates = build_candidates_from_youtube_api(fallback_rows)
        fallback_scored = rerank_candidates(
            candidates=fallback_candidates,
            keywords=scoring_ctx["keywords"],
            preferred_cities=scoring_ctx["preferred_cities"],
            budget_pref=scoring_ctx["budget_pref"],
            pace_pref=scoring_ctx["pace_pref"],
            constraints=scoring_ctx["constraints"],
            interaction_scores=get_user_interaction_scores(user_id),
            query_text=fallback_query,
            place_names=place_names_for_rerank,
            limit=min(40, max(limit, 5)),
        )
        scored = fallback_scored[:limit]
    return _attach_db_video_ids(scored_to_response(scored))


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


async def _geocode_region_nominatim(region: str) -> Optional[Dict[str, Any]]:
    """當 Open-Meteo 無結果時使用 Nominatim 解析地名（支援日文等，如熊本）。"""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": region, "format": "json", "limit": 1},
            headers={"User-Agent": HTTP_USER_AGENT},
        )
    if response.status_code >= 400:
        return None
    data = response.json() if response.content else []
    if not isinstance(data, list) or not data:
        return None
    top = data[0]
    try:
        lat = float(top.get("lat"))
        lng = float(top.get("lon"))
    except (TypeError, ValueError):
        return None
    name = (top.get("display_name") or "").split(",")[0].strip() or top.get("name") or region
    address = top.get("address") or {}
    country = address.get("country", "") if isinstance(address, dict) else ""
    return {"latitude": lat, "longitude": lng, "name": name, "country": country}


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
        if isinstance(geo_rows, list) and geo_rows:
            top = geo_rows[0]
            lat = top.get("latitude")
            lng = top.get("longitude")
            if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                resolved_name = top.get("name") or region
                country = top.get("country") or ""
            else:
                top = None
        else:
            top = None
        if top is None:
            nominatim = await _geocode_region_nominatim(region)
            if not nominatim:
                return {"region": region, "error": "geocoding no result"}
            lat = nominatim["latitude"]
            lng = nominatim["longitude"]
            resolved_name = nominatim["name"]
            country = nominatim["country"]
        else:
            resolved_name = top.get("name") or region
            country = top.get("country") or ""
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
        "resolved_name": resolved_name,
        "country": country,
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
    expected_dim = get_vector_column_dim("segments", "embedding_vector")

    embedding = await embedding_from_ollama(query, embedding_model)
    if embedding:
        if expected_dim and len(embedding) != expected_dim:
            print(
                "[search_segments_internal] embedding dimension mismatch, "
                f"expected={expected_dim}, got={len(embedding)}, model={embedding_model or OLLAMA_EMBED_MODEL}"
            )
        else:
            try:
                vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"
                if city:
                    dense_rows = fetch_all(
                        """
                        SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                               v.title AS video_title,
                               COALESCE(place_meta.place_names, '') AS place_names,
                               (s.embedding_vector <=> %s::vector) AS distance
                        FROM segments s
                        JOIN videos v ON v.id = s.video_id
                        LEFT JOIN LATERAL (
                            SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                            FROM segment_places sp
                            JOIN places p ON p.id = sp.place_id
                            WHERE sp.segment_id = s.id
                        ) AS place_meta ON TRUE
                        WHERE s.embedding_vector IS NOT NULL
                          AND s.city = %s
                        ORDER BY s.embedding_vector <=> %s::vector
                        LIMIT %s
                        """,
                        (vector_literal, city, vector_literal, HYBRID_VECTOR_TOP_K),
                    )
                else:
                    dense_rows = fetch_all(
                        """
                        SELECT s.id, s.video_id, s.start_sec, s.end_sec, s.summary, s.tags, s.city, s.created_at,
                               v.title AS video_title,
                               COALESCE(place_meta.place_names, '') AS place_names,
                               (s.embedding_vector <=> %s::vector) AS distance
                        FROM segments s
                        JOIN videos v ON v.id = s.video_id
                        LEFT JOIN LATERAL (
                            SELECT string_agg(DISTINCT p.name, ' ') AS place_names
                            FROM segment_places sp
                            JOIN places p ON p.id = sp.place_id
                            WHERE sp.segment_id = s.id
                        ) AS place_meta ON TRUE
                        WHERE s.embedding_vector IS NOT NULL
                        ORDER BY s.embedding_vector <=> %s::vector
                        LIMIT %s
                        """,
                        (vector_literal, vector_literal, HYBRID_VECTOR_TOP_K),
                    )

                like_keyword = f"%{query}%"
                sparse_rows: List[Dict[str, Any]] = []
                if keyword:
                    if city:
                        sparse_rows = fetch_all(
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
                            (
                                city,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                HYBRID_KEYWORD_TOP_K,
                            ),
                        )
                    else:
                        sparse_rows = fetch_all(
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
                            (
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                like_keyword,
                                HYBRID_KEYWORD_TOP_K,
                            ),
                        )

                rows: List[Dict[str, Any]] = []
                mode = "hybrid-rrf"
                if dense_rows and sparse_rows:
                    rows = reciprocal_rank_fusion(dense_rows, sparse_rows, final_limit=limit)
                elif dense_rows:
                    rows = dense_rows[:limit]
                    mode = "pgvector"
                elif sparse_rows:
                    rows = sparse_rows[:limit]
                    mode = "keyword-only"

                if rows:
                    for row in rows:
                        row.pop("_rank_score", None)
                    return {"mode": mode, "items": rows}
            except psycopg.Error as error:
                print(f"[search_segments_internal] pgvector search failed, fallback to keyword mode: {error}")

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


def _db_video_id_for_youtube(youtube_id: str) -> Optional[int]:
    y = (youtube_id or "").strip()
    if not y:
        return None
    row = fetch_one("SELECT id FROM videos WHERE youtube_id = %s", (y,))
    if not row or row.get("id") is None:
        return None
    return int(row["id"])


@app.get("/api/videos/by-youtube/{youtube_id}/segments")
def get_video_segments_by_youtube(youtube_id: str) -> List[Dict[str, Any]]:
    vid = _db_video_id_for_youtube(youtube_id)
    if vid is None:
        return []
    return get_video_segments(vid)


def _parse_json_from_llm(text: str) -> Optional[Dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    block = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if block:
        try:
            return json.loads(block.group(1).strip())
        except json.JSONDecodeError:
            pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


async def _ollama_video_outline_json(user_content: str, video_id: int, city: str) -> Dict[str, Any]:
    system_prompt = (
        "你是旅遊影片分析助手。請只輸出一段合法 JSON，不要加說明文字。"
        "JSON 格式："
        '{"overall_summary":"全片 2–4 句話摘要（繁體中文）",'
        '"segments":[{"start_sec":整數秒,"end_sec":整數秒,"summary":"一句話大意","tags":["標籤"]}]}。'
        "segments 內項目依時間排序；若沒有時間軸資訊，segments 可為空陣列。"
    )
    async with httpx.AsyncClient(timeout=httpx.Timeout(75.0, connect=10.0)) as client:
        r = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "options": {"temperature": 0.3, "num_predict": 1200},
            },
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ollama error: {r.status_code}")
    data = r.json()
    raw_text = (data.get("message") or {}).get("content") or ""
    parsed = _parse_json_from_llm(raw_text)
    if not parsed:
        return {"overall_summary": "", "segments": [], "error": "parse_failed"}
    overall = str(parsed.get("overall_summary") or "").strip()
    raw_seg_list = parsed.get("segments")
    out_segments: List[Dict[str, Any]] = []
    if isinstance(raw_seg_list, list):
        for idx, item in enumerate(raw_seg_list[:40]):
            if not isinstance(item, dict):
                continue
            start_sec = int(item.get("start_sec") or 0)
            end_sec = int(item.get("end_sec") or start_sec)
            summary = str(item.get("summary") or "").strip()
            tags = item.get("tags")
            tag_list: List[str] = []
            if isinstance(tags, list):
                tag_list = [str(t) for t in tags if t]
            elif isinstance(tags, str) and tags.strip():
                tag_list = [tags.strip()]
            out_segments.append(
                {
                    "id": idx + 1,
                    "video_id": video_id,
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "summary": summary,
                    "tags": tag_list,
                    "city": city or None,
                    "created_at": "",
                }
            )
    return {"overall_summary": overall, "segments": out_segments}


@app.post("/api/videos/{video_id}/ai-outline")
async def post_video_ai_outline(
    video_id: int,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    video = fetch_one(
        """
        SELECT id, youtube_id, title, channel, city, summary
        FROM videos
        WHERE id = %s
        """,
        (video_id,),
    )
    if not video:
        raise HTTPException(status_code=404, detail="video not found")
    segs = fetch_all(
        """
        SELECT start_sec, end_sec, summary
        FROM segments
        WHERE video_id = %s
        ORDER BY start_sec ASC
        """,
        (video_id,),
    )
    pieces: List[str] = []
    for s in segs:
        sm = str(s.get("summary") or "").strip()
        if sm:
            pieces.append(
                f"[{int(s.get('start_sec') or 0)}s-{int(s.get('end_sec') or 0)}s] {sm}"
            )
    title = str(video.get("title") or "")
    city = str(video.get("city") or "")
    if pieces:
        user_content = (
            "影片資訊：\n"
            f"標題：{title}\n"
            f"城市：{city}\n\n"
            "既有片段摘要（依時間軸）：\n"
            + "\n".join(pieces[:80])
            + "\n\n"
            "請根據以上文字產出 JSON。"
        )
    else:
        user_content = (
            "影片資訊：\n"
            f"標題：{title}\n"
            f"城市：{city}\n\n"
            "目前資料庫尚無片段文字。請僅依標題與城市推測一則旅遊主題摘要；"
            "segments 請回傳空陣列 []。"
        )

    return await _ollama_video_outline_json(user_content, video_id, city)


@app.post("/api/videos/by-youtube/{youtube_id}/ai-outline")
async def post_video_ai_outline_by_youtube(
    youtube_id: str,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    vid = _db_video_id_for_youtube(youtube_id)
    if vid is None:
        raise HTTPException(status_code=404, detail="video not found")
    return await post_video_ai_outline(vid, request, x_internal_token)


@app.post("/api/videos/preview-ai-outline")
async def post_preview_video_outline(
    payload: PreviewVideoOutlineRequest,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    title = (payload.title or "").strip()
    city = (payload.city or "").strip()
    desc = (payload.description or "").strip()
    user_content = (
        "影片資訊（可能尚未入庫）：\n"
        f"標題：{title}\n"
        f"城市：{city}\n"
        f"描述：{desc[:2000]}\n\n"
        "請僅依標題、城市與描述推測旅遊主題摘要；"
        "若無時間軸資訊，segments 請回傳空陣列 []。"
    )
    return await _ollama_video_outline_json(user_content, 0, city)


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


@app.post("/api/recommendation/more")
async def recommendation_more(
    payload: RecommendationMoreRequest,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    query = (payload.last_query or "").strip() or "旅遊"
    videos = await get_recommended_videos(
        query=query,
        city=payload.city,
        user_id=payload.user_id,
        limit=payload.limit,
        exclude_youtube_ids=payload.exclude_youtube_ids or None,
    )
    return {"recommended_videos": videos}


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

    conv_ctx = build_conversation_context(
        current_message=payload.message,
        messages=safe_history,
        itinerary_places=payload.itinerary_places,
    )
    enhanced_query = conv_ctx.get("enhanced_query") or payload.message
    rag_query = enhanced_query if len(enhanced_query) <= 200 else payload.message

    rag_city = payload.city or (
        conv_ctx["all_relevant_cities"][0] if conv_ctx.get("all_relevant_cities") else None
    )
    rag = await search_segments_internal(
        query=rag_query,
        city=rag_city,
        limit=5,
        embedding_model=None,
    )
    rag_items = rag.get("items") or []
    if _user_requests_structured_itinerary(payload.message, conv_ctx) and len(rag_items) < 8:
        cities = [str(c).strip() for c in (conv_ctx.get("all_relevant_cities") or []) if isinstance(c, str) and str(c).strip()]
        broad_parts = cities[:3] + ["旅遊", "景點", "推薦"]
        broad_query = " ".join(broad_parts)[:200] if cities else (rag_query or "旅遊景點 推薦")
        extra_rag = await search_segments_internal(
            query=broad_query,
            city=rag_city,
            limit=25,
            embedding_model=None,
        )
        rag_items = _merge_rag_items(rag_items, extra_rag.get("items") or [])
    rag_context = build_rag_context(rag_items)
    user_profile_context = build_user_profile_context(payload.user_id)
    user_ai_settings = get_user_ai_settings(payload.user_id)
    preference_hits = await retrieve_user_preferences(payload.user_id, payload.message, limit=5, similarity_threshold=0.8)
    recommended_videos = await get_recommended_videos(
        query=payload.message,
        city=payload.city,
        user_id=payload.user_id,
        limit=5,
        conversation_context=conv_ctx,
    )

    system_text = (
        "你是 AIYO 旅遊規劃助理，一位經驗豐富、熱情友善的旅遊顧問。"
        "請全程使用繁體中文回覆，嚴禁使用簡體中文或大陸用詞。"
        "\n\n"
        "## 核心角色\n"
        "你的任務是透過自然對話幫助使用者規劃個人化旅遊行程。"
        "你具備以下能力：行程規劃、景點推薦、美食建議、交通安排、預算管理、即時資訊查詢。"
        "你的語氣溫暖且專業，像一位去過當地的好友在給建議。"
        "回覆請使用 Markdown 格式，善用標題、條列、粗體來增加可讀性。"
        "\n\n"
        "## 回覆格式限制\n"
        "- 嚴禁在回覆中使用任何 emoji 或表情符號。\n"
        "- 僅使用純文字和 Markdown 格式來表達內容。\n"
        "\n"
        "## 互動式選項\n"
        "當你提出有明確選項的問題時，必須在問題後方附上選項標記，格式為：\n"
        "[options: 選項A, 選項B, 選項C]\n"
        "使用規則：\n"
        "1. 僅在可列舉答案的問題使用（如天數、預算、旅伴、興趣）。\n"
        "2. 開放式問題不要加選項標記。\n"
        "3. 每個選項保持 2-8 字，選項數建議 2-6 個，不超過 8 個。\n"
        "4. 選項標記必須獨立一行，放在問題段落後方。\n"
        "\n\n"
        "## 對話策略\n"
        "1. **主動蒐集關鍵資訊**：在開始規劃前，你需要掌握以下資訊（若使用者未提供，請自然地引導詢問）：\n"
        "   - 目的地（國家/城市）\n"
        "   - 旅行天數與日期\n"
        "   - 同行人數與組成（大人幾位、兒童幾位及年齡、嬰兒幾位）\n"
        "     [options: 1大人, 2大人, 2大1小, 2大2小, 家庭多人, 朋友團, 獨旅]\n"
        "   - 旅遊型態（自由行、包車旅遊、跟團、深度慢遊、背包客等）\n"
        "     [options: 自由行, 包車旅遊, 跟團, 深度慢遊, 背包客]\n"
        "   - 每人預算範圍\n"
        "     [options: NT$20,000以下, NT$20,000-30,000, NT$30,000-50,000, NT$50,000-70,000, NT$70,000以上]\n"
        "   - 住宿等級偏好\n"
        "     [options: 青旅/背包客棧, 平價旅館, 三星商旅, 四星飯店, 五星/度假村]\n"
        "   - 興趣偏好（美食、文化、自然、購物、冒險、放鬆等）\n"
        "   - 必走景點（使用者特別想去的地方）\n"
        "   - 排除景點（使用者明確不想去的地方）\n"
        "   - 特殊需求（無障礙設施、嬰兒車友善、具體飲食限制如素食/清真/過敏等）\n"
        "   - 航班偏好（是否需要安排機票、直飛/轉機、航空公司偏好）\n"
        "2. **不要一次問太多問題**：每次最多追問 1-2 個關鍵問題，保持對話流暢。\n"
        "3. **邊聊邊推薦**：即使資訊不完整也可以先給初步建議，再根據回饋調整。\n"
        "4. **記住上下文**：使用者在對話中提到的所有偏好、去過的地方、不喜歡的東西都要記住並應用。\n"
        "\n"
        "## 行程規劃原則\n"
        "- **合理節奏**：每天安排 2-4 個主要景點，預留交通和用餐時間，避免行程過於緊湊。\n"
        "- **地理動線**：同一天的景點應在地理上相近，減少來回奔波。\n"
        "- **多元體驗**：結合不同類型的活動（觀光、美食、體驗、休閒），避免單調。\n"
        "- **在地特色**：優先推薦當地獨有的體驗，而非連鎖或觀光客商業區。\n"
        "- **實用資訊**：提供景點的大約停留時間、建議到訪時段、門票費用、交通方式。\n"
        "- **彈性備案**：適時提供雨天備案或替代方案。\n"
        "- **預算分配**：依每人預算區間合理分配住宿、交通、餐飲與門票，並在行程中標註預估花費。\n"
        "- **人員適配**：若有兒童或嬰兒，優先推薦親子友善景點與餐廳，避免長時間步行或高難度路線。\n"
        "- **住宿匹配**：依住宿等級偏好推薦對應檔次的飯店或旅館，並標註每晚參考價格。\n"
        "- **必走與排除**：必走景點優先排入行程；絕對不推薦使用者明確排除的地點。\n"
        "- **無障礙考量**：若有行動不便或嬰兒車需求，應確認景點與交通是否具備無障礙設施。\n"
        "\n"
        "## 行程呈現格式\n"
        "當提供完整的每日行程時，請按以下結構呈現：\n"
        "```\n"
        "### DAY 1 - 標題（如「抵達與老城探索」）\n"
        "- **上午**：景點名稱 - 簡要說明（停留約 X 小時）\n"
        "- **午餐**：餐廳/區域推薦 - 推薦料理\n"
        "- **下午**：景點名稱 - 簡要說明\n"
        "- **晚餐**：餐廳推薦\n"
        "- **晚上**：夜間活動建議（可選）\n"
        "- 交通提示：如何往返各景點\n"
        "- 預估花費：約 NT$ XXX\n"
        "```\n"
        "\n"
        "## 回覆原則\n"
        "- 若使用者的問題超出旅遊範疇，禮貌地將話題引導回旅遊規劃。\n"
        "- 不確定的資訊請明確標註，不要編造數據（如票價、營業時間）。\n"
        "- 對於時效性資訊（票價、匯率、營業時間），提醒使用者出發前再次確認。\n"
        "- 回答要具體實用，避免空泛建議如「可以去逛逛」，應給出明確的地點、料理、路線。\n"
        "- 適當使用影片片段作為推薦依據，增加說服力。\n"
    )
    tool_policy = user_ai_settings.get("tool_policy_json") if isinstance(user_ai_settings, dict) else {}
    custom_tool_rules = ""
    if isinstance(tool_policy, dict):
        custom_tool_rules = str(tool_policy.get("tool_trigger_rules") or "").strip()
    system_text += (
        "\n## 工具使用規則\n"
        "你可以使用 MCP 工具來查詢即時資料。"
        "當使用者詢問即時時間、景點營業時間、交通、票價、活動或其他時效性旅遊資訊時，"
        "優先呼叫工具再回答；若工具回傳不足，需明確告知不確定處。"
        "\n\n**天氣回覆格式**：回覆天氣查詢時請分項條列以下項目（每項一行），最後再寫提醒。"
        "依序為：（1）天氣狀況（如晴天、多雲、雨天等）（2）氣溫（°C）（3）體感溫度（°C）（4）是否有降水（有雨/無降水，若有雨可註明雨量）（5）風速（如 m/s）。"
        "最後一段為提醒：此為即時資料，實際情況可能因時間變化而不同，建議出行前再次確認最新資訊。"
    )
    if custom_tool_rules:
        system_text += f"\n\n使用者自訂工具規則：{custom_tool_rules}"
    if user_profile_context:
        system_text += (
            "\n\n以下是使用者的短期與長期記憶資料（僅供參考，不可未經確認就當成既定事實）：\n"
            f"{user_profile_context}\n"
            "硬性規則：在引用或依據任何長期記憶規劃行程前，必須先用簡短問句向使用者確認本次是否仍適用"
            "（例如：「這次是否仍依您先前偏好的住宿等級與主題？若要調整請告訴我」），"
            "並可提供選項，格式可沿用 [options: 選項一 | 選項二 | 選項三]。"
            "在取得使用者確認前，禁止以肯定語氣陳述「我記得您一定是…」「您上次說過所以這次一定…」等獨斷說法；"
            "可改為「若與上次相同請回覆沿用；若要調整請說明」。"
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
            "使用方式：僅在經使用者確認後，再依偏好調整行程或影片建議；若彼此衝突，優先採用更新時間較新的偏好。"
            "引用前仍須簡短確認，不得逕行假設使用者本次意圖與偏好紀錄一致。"
        )
    conv_cities = conv_ctx.get("mentioned_cities") or []
    conv_topics = conv_ctx.get("topics") or []
    itin_cities = conv_ctx.get("itinerary_cities") or []
    if conv_cities or conv_topics or itin_cities:
        context_parts: List[str] = []
        if conv_cities:
            context_parts.append(f"對話中提到的城市：{'、'.join(conv_cities[:8])}")
        if itin_cities:
            context_parts.append(f"使用者行程包含的城市：{'、'.join(itin_cities[:8])}")
        if conv_topics:
            context_parts.append(f"對話涉及的旅遊主題：{'、'.join(conv_topics[:10])}")
        system_text += (
            "\n\n以下是從對話脈絡中擷取的資訊，請用於個人化回覆和推薦：\n"
            + "\n".join(context_parts) + "\n"
            "當推薦行程或回答問題時，請考量使用者在整段對話中表達的所有興趣和目的地，而非僅限於最新訊息。"
        )
    if rag_context:
        system_text += VIDEO_SEGMENT_PRESENTATION_RULES
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

    async with httpx.AsyncClient(timeout=CHAT_HTTP_TIMEOUT) as client:
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
        youtube_tool_videos = resolved.get("youtube_tool_videos") if isinstance(resolved.get("youtube_tool_videos"), list) else []
        if youtube_tool_videos:
            seen_yt = {v.get("youtube_id") for v in youtube_tool_videos if v.get("youtube_id")}
            merged = list(youtube_tool_videos)[:10]
            for v in recommended_videos:
                if len(merged) >= 10:
                    break
                yid = v.get("youtube_id") if isinstance(v, dict) else getattr(v, "youtube_id", None)
                if yid and yid not in seen_yt:
                    merged.append(v)
                    seen_yt.add(yid)
            recommended_videos = merged

        if payload.stream:
            if direct_reply and not used_mcp_tools:
                async def direct_event_stream():
                    yield f"data: {json.dumps({'token': direct_reply}, ensure_ascii=False)}\n\n"
                    itinerary_plan: Optional[Dict[str, Any]] = None
                    try:
                        itinerary_plan = build_chat_itinerary_plan_if_applicable(payload, conv_ctx, rag_items)
                    except Exception:
                        itinerary_plan = None
                    done_payload: Dict[str, Any] = {
                        "done": True,
                        "recommended_videos": recommended_videos,
                        "used_mcp_tools": False,
                        "tool_calls_summary": tool_calls_summary,
                    }
                    if itinerary_plan is not None:
                        done_payload["itinerary_plan"] = itinerary_plan
                    yield "data: " + json.dumps(done_payload, ensure_ascii=False) + "\n\n"
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
                json={
                    "model": model,
                    "stream": True,
                    "messages": final_messages,
                    "options": _ollama_chat_options(),
                },
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
                        itinerary_plan: Optional[Dict[str, Any]] = None
                        try:
                            itinerary_plan = build_chat_itinerary_plan_if_applicable(
                                payload, conv_ctx, rag_items
                            )
                        except Exception:
                            itinerary_plan = None
                        done_payload: Dict[str, Any] = {
                            "done": True,
                            "recommended_videos": recommended_videos,
                            "used_mcp_tools": used_mcp_tools,
                            "tool_calls_summary": tool_calls_summary,
                        }
                        if itinerary_plan is not None:
                            done_payload["itinerary_plan"] = itinerary_plan
                        yield "data: " + json.dumps(done_payload, ensure_ascii=False) + "\n\n"
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
            json={
                "model": model,
                "stream": False,
                "messages": final_messages,
                "options": _ollama_chat_options(),
            },
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
        itinerary_plan: Optional[Dict[str, Any]] = None
        try:
            itinerary_plan = build_chat_itinerary_plan_if_applicable(payload, conv_ctx, rag_items)
        except Exception:
            itinerary_plan = None
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
        out: Dict[str, Any] = {
            "reply": text,
            "recommended_videos": recommended_videos,
            "used_mcp_tools": used_mcp_tools,
            "tool_calls_summary": tool_calls_summary,
        }
        if itinerary_plan is not None:
            out["itinerary_plan"] = itinerary_plan
        return out
