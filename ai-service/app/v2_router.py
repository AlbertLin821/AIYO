from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import psycopg
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.rows import dict_row

from app.planner import PlannerConstraints, plan_itinerary_v2, planner_result_to_response

router = APIRouter(prefix="/api/v2")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db")
INTERNAL_SERVICE_TOKEN = os.getenv("AI_SERVICE_INTERNAL_TOKEN", "")
ALLOWED_INTERNAL_IPS = [
    item.strip()
    for item in os.getenv("AI_SERVICE_ALLOWED_IPS", "127.0.0.1,::1").split(",")
    if item.strip()
]

V2_RECOMMEND_SYNC_TIMEOUT_SEC = float(os.getenv("V2_RECOMMEND_SYNC_TIMEOUT_SEC", "3.5"))
V2_PLAN_SYNC_TIMEOUT_SEC = float(os.getenv("V2_PLAN_SYNC_TIMEOUT_SEC", "5.0"))
V2_JOB_POLL_AFTER_MS = int(os.getenv("V2_JOB_POLL_AFTER_MS", "1200"))
V2_EMBED_MODEL_NAME = os.getenv("V2_EMBED_MODEL_NAME", "nomic-embed-text")
V2_EMBED_MODEL_VERSION = os.getenv("V2_EMBED_MODEL_VERSION", "1")
V2_EMBED_DIM = int(os.getenv("V2_EMBED_DIM", "768"))
V2_YOUTUBE_STATS_TTL_HOURS = int(os.getenv("V2_YOUTUBE_STATS_TTL_HOURS", "24"))
V2_GEOCODE_MAX_RETRIES = int(os.getenv("V2_GEOCODE_MAX_RETRIES", "3"))

_DAYS_RE = re.compile(r"(\d{1,2})\s*(?:\u5929|\u65e5|days?)", re.IGNORECASE)
_BUDGET_RE = re.compile(
    r"(?:\u9810\u7b97|budget)\s*[:\uFF1A]?\s*([^\s,\uFF0C\u3002\uFF1B;]{1,24})",
    re.IGNORECASE,
)
_DEST_RE = re.compile(
    r"(?:\u53bb|\u5230|\u524d\u5f80|\u60f3\u53bb|\u65c5\u904a|\u65c5\u884c|travel to|go to|visit)\s*([A-Za-z\u4e00-\u9fff\-\s]{2,40})",
    re.IGNORECASE,
)
_TRACE_RE = re.compile(r"^[a-fA-F0-9]{12,64}$")

_PREFERENCE_TOKENS = [
    "\u7f8e\u98df",  # food
    "\u666f\u9ede",  # spots
    "\u89aa\u5b50",  # family
    "\u6b65\u884c",  # walk
    "\u81ea\u99d5",  # drive
    "\u535a\u7269\u9928",  # museum
    "\u591c\u666f",  # night view
    "shopping",
    "hiking",
    "museum",
]


class VoiceIntentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    traceId: Optional[str] = None


class RecommendVideosRequest(BaseModel):
    query: str = ""
    destination: Optional[str] = None
    days: int = Field(default=3, ge=1, le=14)
    budget: Optional[str] = None
    preferences: List[str] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=20)
    traceId: Optional[str] = None
    userId: Optional[str] = None
    embeddingModel: Optional[str] = None
    embeddingVersion: Optional[str] = None
    embeddingDim: Optional[int] = None


class PlanFromIntentRequest(BaseModel):
    query: str = ""
    destination: Optional[str] = None
    days: int = Field(default=3, ge=1, le=14)
    budget: Optional[str] = None
    preferences: List[str] = Field(default_factory=list)
    limit: int = Field(default=12, ge=1, le=40)
    traceId: Optional[str] = None
    userId: Optional[str] = None
    embeddingModel: Optional[str] = None
    embeddingVersion: Optional[str] = None
    embeddingDim: Optional[int] = None


def _normalize_trace_id(raw: Optional[str]) -> str:
    text = str(raw or "").strip()
    if text and _TRACE_RE.match(text):
        return text.lower()
    return uuid.uuid4().hex[:32]


def _extract_destination(text: str) -> str:
    source = (text or "").strip()
    if not source:
        return ""
    matched = _DEST_RE.search(source)
    if not matched:
        return ""
    candidate = re.sub(r"\s+", " ", matched.group(1)).strip(" ,\uFF0C\u3002")
    return candidate[:40]


def parse_voice_intent_text(text: str) -> Dict[str, Any]:
    source = (text or "").strip()
    days = 3
    days_match = _DAYS_RE.search(source)
    if days_match:
        try:
            days = max(1, min(14, int(days_match.group(1))))
        except ValueError:
            days = 3

    budget = None
    budget_match = _BUDGET_RE.search(source)
    if budget_match:
        budget = budget_match.group(1).strip()[:24]

    destination = _extract_destination(source)
    if not destination and len(source) <= 40:
        destination = source[:40]

    preferences: List[str] = []
    lowered = source.lower()
    for token in _PREFERENCE_TOKENS:
        if token.lower() in lowered:
            preferences.append(token)

    dedup_preferences: List[str] = []
    seen: set[str] = set()
    for item in preferences:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        dedup_preferences.append(item)

    return {
        "destination": destination or None,
        "days": days,
        "budget": budget,
        "preferences": dedup_preferences,
    }


def _coerce_iso(dt: Any) -> Optional[str]:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _stats_stale(stats_updated_at: Any) -> bool:
    if not isinstance(stats_updated_at, datetime):
        return True
    ref = stats_updated_at
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    return ref < datetime.now(timezone.utc) - timedelta(hours=V2_YOUTUBE_STATS_TTL_HOURS)


def _extract_budget_value(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    digits = re.sub(r"[^\d.]", "", str(raw))
    if not digits:
        return None
    try:
        value = float(digits)
    except ValueError:
        return None
    if value <= 0:
        return None
    return value


def _extract_transport_pref(preferences: List[str]) -> str:
    joined = " ".join(preferences).lower()
    if "\u81ea\u99d5" in joined or "drive" in joined or "car" in joined:
        return "drive"
    if "\u6b65\u884c" in joined or "walk" in joined:
        return "walk"
    if "bike" in joined or "\u81ea\u884c\u8eca" in joined:
        return "bike"
    return "transit"


def _extract_pace_pref(preferences: List[str]) -> str:
    joined = " ".join(preferences).lower()
    if "\u6162" in joined or "relax" in joined:
        return "\u6162"
    if "\u8d95" in joined or "intense" in joined:
        return "\u5feb"
    return ""


def _extract_user_uuid(raw_user_id: Optional[str]) -> Optional[str]:
    if not raw_user_id:
        return None
    text = str(raw_user_id).strip()
    try:
        return str(uuid.UUID(text))
    except ValueError:
        return None


def _get_conn() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def _fetch_one(query: str, params: Tuple[Any, ...] = ()) -> Optional[Dict[str, Any]]:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchone()


def _fetch_all(query: str, params: Tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return list(cur.fetchall())


def _execute(query: str, params: Tuple[Any, ...] = ()) -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            conn.commit()


def _maybe_mark_geocode_retry_exhausted() -> None:
    try:
        _execute(
            """
            UPDATE v2.segment_places
            SET geocode_status = 'failed'
            WHERE geocode_status = 'pending'
              AND COALESCE(geocode_retry_count, 0) >= %s
            """,
            (V2_GEOCODE_MAX_RETRIES,),
        )
    except Exception:
        pass


def _ensure_v2_schema_ready() -> None:
    row = _fetch_one("SELECT to_regclass('v2.video_segments') AS rel")
    if not row or not row.get("rel"):
        raise HTTPException(status_code=503, detail="v2 schema not ready")


def _ensure_embedding_contract(
    model: Optional[str], version: Optional[str], dim: Optional[int]
) -> None:
    if model is not None and model != V2_EMBED_MODEL_NAME:
        raise HTTPException(status_code=422, detail="embeddingModel must be nomic-embed-text in P1")
    if version is not None and version != V2_EMBED_MODEL_VERSION:
        raise HTTPException(status_code=422, detail="embeddingVersion mismatch for current index")
    if dim is not None and dim != V2_EMBED_DIM:
        raise HTTPException(status_code=422, detail="embeddingDim mismatch: P1 requires 768")


def _maybe_insert_voice_intent_log(trace_id: str, user_id: Optional[str], text: str, parsed: Dict[str, Any]) -> None:
    try:
        _execute(
            """
            INSERT INTO v2.voice_intent_logs (trace_id, user_id, input_text, parsed_json)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (trace_id, user_id, text, json.dumps(parsed, ensure_ascii=False)),
        )
    except Exception:
        pass


def _maybe_insert_recommend_event(trace_id: str, user_id: Optional[str], payload: Dict[str, Any]) -> None:
    try:
        _execute(
            """
            INSERT INTO v2.recommendation_events (trace_id, user_id, event_type, payload_json)
            VALUES (%s, %s, %s, %s::jsonb)
            """,
            (trace_id, user_id, "recommend_response", json.dumps(payload, ensure_ascii=False)),
        )
    except Exception:
        pass


def _maybe_insert_planner_run(
    trace_id: str,
    user_id: Optional[str],
    intent_json: Dict[str, Any],
    result_json: Dict[str, Any],
    duration_ms: int,
) -> None:
    try:
        _execute(
            """
            INSERT INTO v2.planner_runs (trace_id, user_id, intent_json, result_json, duration_ms)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s)
            """,
            (
                trace_id,
                user_id,
                json.dumps(intent_json, ensure_ascii=False),
                json.dumps(result_json, ensure_ascii=False),
                duration_ms,
            ),
        )
    except Exception:
        pass


def _fetch_recommendation_rows(query: str, destination: Optional[str], limit: int) -> List[Dict[str, Any]]:
    where_parts = ["1=1"]
    params: List[Any] = [V2_EMBED_MODEL_NAME, V2_EMBED_MODEL_VERSION, V2_EMBED_DIM]

    text_query = (query or "").strip()
    if text_query:
        like = f"%{text_query}%"
        where_parts.append(
            "(COALESCE(s.summary, '') ILIKE %s OR COALESCE(v.title, '') ILIKE %s OR COALESCE(p.name, '') ILIKE %s)"
        )
        params.extend([like, like, like])

    city = (destination or "").strip()
    if city:
        like_city = f"%{city}%"
        where_parts.append(
            "(COALESCE(s.city, '') ILIKE %s OR COALESCE(v.city, '') ILIKE %s OR COALESCE(p.city, '') ILIKE %s)"
        )
        params.extend([like_city, like_city, like_city])

    params.append(max(15, min(300, limit)))
    where_sql = " AND ".join(where_parts)

    return _fetch_all(
        f"""
        SELECT
          s.id AS segment_id,
          s.video_id,
          s.start_sec,
          s.end_sec,
          COALESCE(s.summary, '') AS summary,
          COALESCE(s.city, '') AS segment_city,
          v.youtube_id,
          v.title AS video_title,
          COALESCE(v.channel, '') AS channel_name,
          COALESCE(v.city, '') AS video_city,
          p.id AS internal_place_id,
          p.google_place_id,
          COALESCE(p.name, '') AS place_name,
          CASE WHEN sp.geocode_status = 'ok' THEN p.lat ELSE NULL END AS lat,
          CASE WHEN sp.geocode_status = 'ok' THEN p.lng ELSE NULL END AS lng,
          COALESCE(sp.geocode_status, 'pending') AS geocode_status,
          COALESCE(sp.geocode_retry_count, 0) AS geocode_retry_count,
          sp.geocode_confidence,
          ys.fetched_at AS stats_updated_at,
          ys.view_count,
          ys.like_count,
          CASE WHEN se.segment_id IS NULL THEN FALSE ELSE TRUE END AS embedding_ok
        FROM v2.video_segments s
        JOIN v2.videos v ON v.id = s.video_id
        LEFT JOIN v2.segment_places sp ON sp.segment_id = s.id
        LEFT JOIN v2.places p ON p.id = sp.place_id
        LEFT JOIN v2.youtube_stats_cache ys ON ys.youtube_id = v.youtube_id
        LEFT JOIN v2.segment_embeddings se
          ON se.segment_id = s.id
         AND se.model_name = %s
         AND se.model_version = %s
         AND se.dim = %s
        WHERE {where_sql}
        ORDER BY
          CASE COALESCE(sp.geocode_status, 'pending')
            WHEN 'ok' THEN 0
            WHEN 'pending' THEN 1
            ELSE 2
          END,
          CASE WHEN se.segment_id IS NULL THEN 1 ELSE 0 END,
          s.created_at DESC
        LIMIT %s
        """,
        tuple(params),
    )


def normalize_contract_item(row: Dict[str, Any], query: str, destination: Optional[str]) -> Dict[str, Any]:
    reason: List[str] = []
    query_text = (query or "").strip().lower()
    destination_text = (destination or "").strip().lower()
    summary = str(row.get("summary") or "")
    title = str(row.get("video_title") or "")
    place_name = str(row.get("place_name") or "")
    segment_city = str(row.get("segment_city") or "")
    video_city = str(row.get("video_city") or "")

    if query_text and (
        query_text in summary.lower()
        or query_text in title.lower()
        or query_text in place_name.lower()
    ):
        reason.append("query_match")
    if destination_text and (
        destination_text in segment_city.lower()
        or destination_text in video_city.lower()
        or destination_text in place_name.lower()
    ):
        reason.append("destination_match")
    if row.get("embedding_ok"):
        reason.append("embedding_index_match")
    geocode_status = str(row.get("geocode_status") or "pending")
    geocode_retry_count = int(row.get("geocode_retry_count") or 0)
    if geocode_status == "failed":
        reason.append("marker_hidden_geocode_failed")
    elif geocode_status == "pending":
        if geocode_retry_count >= V2_GEOCODE_MAX_RETRIES:
            reason.append("marker_hidden_geocode_retry_exhausted")
        else:
            reason.append("marker_pending_geocode_retry")

    if not reason:
        reason.append("fresh_segment")

    return {
        "internalPlaceId": str(row["internal_place_id"]) if row.get("internal_place_id") else None,
        "googlePlaceId": str(row["google_place_id"]) if row.get("google_place_id") else None,
        "segmentId": str(row["segment_id"]) if row.get("segment_id") else None,
        "lat": float(row["lat"]) if isinstance(row.get("lat"), (int, float)) else None,
        "lng": float(row["lng"]) if isinstance(row.get("lng"), (int, float)) else None,
        "startSec": int(row.get("start_sec") or 0),
        "endSec": int(row.get("end_sec") or 0),
        "reason": reason,
        "statsUpdatedAt": _coerce_iso(row.get("stats_updated_at")),
        "statsStale": _stats_stale(row.get("stats_updated_at")),
        "geocodeStatus": geocode_status,
        "geocodeRetryCount": geocode_retry_count,
        "geocodeConfidence": (
            float(row.get("geocode_confidence"))
            if isinstance(row.get("geocode_confidence"), (int, float))
            else None
        ),
        "placeName": place_name or None,
        "videoTitle": title or None,
        "youtubeId": str(row.get("youtube_id") or "") or None,
        "viewCount": int(row.get("view_count") or 0),
        "likeCount": int(row.get("like_count") or 0),
    }


def _dedupe_contract_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    result: List[Dict[str, Any]] = []
    for item in items:
        segment_id = str(item.get("segmentId") or "")
        place_id = str(item.get("internalPlaceId") or "")
        key = f"{segment_id}:{place_id}"
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _compute_recommendations(payload: RecommendVideosRequest, trace_id: str, full_mode: bool) -> Dict[str, Any]:
    _ensure_v2_schema_ready()
    _maybe_mark_geocode_retry_exhausted()
    row_limit = payload.limit * (5 if full_mode else 3)
    primary_rows = _fetch_recommendation_rows(payload.query, payload.destination, row_limit)
    items = [normalize_contract_item(row, payload.query, payload.destination) for row in primary_rows]
    items = _dedupe_contract_items(items)

    if len(items) < payload.limit:
        fallback_rows = _fetch_recommendation_rows("", payload.destination, row_limit)
        fallback_items = [normalize_contract_item(row, payload.query, payload.destination) for row in fallback_rows]
        items = _dedupe_contract_items(items + fallback_items)

    capped = items[: payload.limit if not full_mode else min(80, payload.limit * 4)]
    response = {
        "items": capped,
        "candidateCount": len(items),
        "embedModel": V2_EMBED_MODEL_NAME,
        "embedVersion": V2_EMBED_MODEL_VERSION,
        "embedDim": V2_EMBED_DIM,
        "traceId": trace_id,
        "geocodeRetryMax": V2_GEOCODE_MAX_RETRIES,
    }
    _maybe_insert_recommend_event(
        trace_id=trace_id,
        user_id=_extract_user_uuid(payload.userId),
        payload=response,
    )
    return response


def _create_pipeline_job(job_type: str, trace_id: str, payload_json: Dict[str, Any]) -> str:
    row = _fetch_one(
        """
        INSERT INTO v2.pipeline_jobs (job_type, status, payload_json, trace_id)
        VALUES (%s, 'pending', %s::jsonb, %s)
        RETURNING id
        """,
        (job_type, json.dumps(payload_json, ensure_ascii=False), trace_id),
    )
    if not row or not row.get("id"):
        raise RuntimeError("unable to create pipeline job")
    return str(row["id"])


def _set_job_running(job_id: str) -> None:
    _execute(
        """
        UPDATE v2.pipeline_jobs
        SET status = 'running', updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (job_id,),
    )


def _set_job_completed(job_id: str, result: Dict[str, Any]) -> None:
    _execute(
        """
        UPDATE v2.pipeline_jobs
        SET status = 'completed', result_json = %s::jsonb, updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (json.dumps(result, ensure_ascii=False), job_id),
    )


def _set_job_failed(job_id: str, error_message: str) -> None:
    _execute(
        """
        UPDATE v2.pipeline_jobs
        SET status = 'failed',
            result_json = %s::jsonb,
            updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (json.dumps({"error": error_message}, ensure_ascii=False), job_id),
    )


def _get_pipeline_job(job_id: str, allowed_types: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    base_query = """
        SELECT id, job_type, status, payload_json, result_json, trace_id, created_at, updated_at
        FROM v2.pipeline_jobs
        WHERE id = %s::uuid
    """
    params: List[Any] = [job_id]
    if allowed_types:
        base_query += " AND job_type = ANY(%s::text[])"
        params.append(allowed_types)
    return _fetch_one(base_query, tuple(params))


def _build_planner_payload(
    payload: PlanFromIntentRequest,
    recommendations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    planner_segments: List[Dict[str, Any]] = []
    for item in recommendations:
        if str(item.get("geocodeStatus") or "") != "ok":
            continue
        place_name = str(item.get("placeName") or item.get("videoTitle") or "").strip()
        if not place_name:
            continue
        planner_segments.append(
            {
                "place_name": place_name,
                "place_id": item.get("internalPlaceId"),
                "segment_id": item.get("segmentId"),
                "lat": item.get("lat"),
                "lng": item.get("lng"),
                "stay_minutes": 75,
                "estimated_cost": 0.0,
            }
        )
    return {"segments": planner_segments}


def _plan_result_to_contract(
    planner_response: Dict[str, Any],
    recommendation_items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    index_by_segment: Dict[str, Dict[str, Any]] = {}
    index_by_segment_place: Dict[Tuple[str, str], Dict[str, Any]] = {}
    failed_segments: List[Dict[str, Any]] = []
    for item in recommendation_items:
        segment_id = str(item.get("segmentId") or "")
        place_id = str(item.get("internalPlaceId") or "")
        if segment_id:
            index_by_segment.setdefault(segment_id, item)
        if segment_id and place_id:
            index_by_segment_place[(segment_id, place_id)] = item
        if str(item.get("geocodeStatus") or "") == "failed":
            failed_segments.append(
                {
                    **item,
                    "manualConfirmationRequired": True,
                }
            )

    days_out: List[Dict[str, Any]] = []
    for day in planner_response.get("days", []):
        slots_out: List[Dict[str, Any]] = []
        for slot in day.get("slots", []):
            segment_id = str(slot.get("segment_id") or "")
            place_id = str(slot.get("place_id") or "")
            matched = index_by_segment_place.get((segment_id, place_id))
            if matched is None and segment_id:
                matched = index_by_segment.get(segment_id)
            slots_out.append(
                {
                    "internalPlaceId": (
                        (matched or {}).get("internalPlaceId")
                        if matched is not None
                        else (place_id or None)
                    ),
                    "googlePlaceId": (matched or {}).get("googlePlaceId") if matched is not None else None,
                    "segmentId": (matched or {}).get("segmentId") if matched is not None else (segment_id or None),
                    "lat": slot.get("lat"),
                    "lng": slot.get("lng"),
                    "startSec": (matched or {}).get("startSec") if matched is not None else None,
                    "endSec": (matched or {}).get("endSec") if matched is not None else None,
                    "reason": (matched or {}).get("reason", []),
                    "statsUpdatedAt": (matched or {}).get("statsUpdatedAt") if matched is not None else None,
                    "statsStale": bool((matched or {}).get("statsStale", True)),
                    "placeName": slot.get("place_name"),
                    "timeStart": slot.get("time_start"),
                    "timeEnd": slot.get("time_end"),
                    "travelMinutesFromPrev": slot.get("travel_minutes_from_prev"),
                    "travelMode": slot.get("travel_mode"),
                }
            )
        days_out.append(
            {
                "dayNumber": day.get("day_number"),
                "warnings": day.get("warnings", []),
                "stops": slots_out,
            }
        )

    return {
        "feasible": planner_response.get("feasible", False),
        "warnings": planner_response.get("warnings", []),
        "days": days_out,
        "unmappedSegments": failed_segments,
    }


def _compute_plan(payload: PlanFromIntentRequest, trace_id: str, full_mode: bool) -> Dict[str, Any]:
    started = datetime.now(timezone.utc)
    recommend_payload = RecommendVideosRequest(
        query=payload.query,
        destination=payload.destination,
        days=payload.days,
        budget=payload.budget,
        preferences=payload.preferences,
        limit=max(payload.limit, payload.days * 4),
        traceId=trace_id,
        userId=payload.userId,
    )
    recommendations_result = _compute_recommendations(recommend_payload, trace_id, full_mode=full_mode)
    recommendation_items = recommendations_result["items"]

    planner_payload = _build_planner_payload(payload, recommendation_items)
    planner_segments = planner_payload["segments"]
    if len(planner_segments) < max(3, payload.days * 2):
        raise ValueError("candidate_insufficient")

    budget = _extract_budget_value(payload.budget)
    constraints = PlannerConstraints(
        budget_total=budget,
        budget_per_day=(budget / payload.days) if budget else None,
        pace=_extract_pace_pref(payload.preferences),
        transport_pref=_extract_transport_pref(payload.preferences),
        must_visit=[],
        avoid=[],
    )
    planner_raw_result = plan_itinerary_v2(
        segments=planner_segments,
        days_count=payload.days,
        constraints=constraints,
        preferences=payload.preferences,
    )
    planner_response = planner_result_to_response(planner_raw_result)
    contract_plan = _plan_result_to_contract(planner_response, recommendation_items)
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    _maybe_insert_planner_run(
        trace_id=trace_id,
        user_id=_extract_user_uuid(payload.userId),
        intent_json=payload.model_dump(),
        result_json=contract_plan,
        duration_ms=duration_ms,
    )
    return {
        "traceId": trace_id,
        "recommendations": recommendation_items,
        "plan": contract_plan,
        "embedModel": V2_EMBED_MODEL_NAME,
        "embedVersion": V2_EMBED_MODEL_VERSION,
        "embedDim": V2_EMBED_DIM,
    }


def _run_recommend_job(job_id: str) -> None:
    try:
        job = _get_pipeline_job(job_id, ["recommend_videos"])
        if not job:
            return
        _set_job_running(job_id)
        payload = RecommendVideosRequest(**(job.get("payload_json") or {}))
        result = _compute_recommendations(payload, str(job.get("trace_id") or uuid.uuid4().hex), full_mode=True)
        _set_job_completed(job_id, result)
    except Exception as exc:
        _set_job_failed(job_id, str(exc))


def _run_plan_job(job_id: str) -> None:
    try:
        job = _get_pipeline_job(job_id, ["plan_from_intent"])
        if not job:
            return
        _set_job_running(job_id)
        payload = PlanFromIntentRequest(**(job.get("payload_json") or {}))
        result = _compute_plan(payload, str(job.get("trace_id") or uuid.uuid4().hex), full_mode=True)
        _set_job_completed(job_id, result)
    except Exception as exc:
        _set_job_failed(job_id, str(exc))


def require_internal_caller(
    request: Request, x_internal_token: Optional[str] = Header(default=None)
) -> None:
    if INTERNAL_SERVICE_TOKEN and x_internal_token == INTERNAL_SERVICE_TOKEN:
        return

    client_ip = request.client.host if request.client else ""
    forwarded_for = request.headers.get("x-forwarded-for") or ""
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip() or client_ip

    if client_ip in ALLOWED_INTERNAL_IPS:
        return

    raise HTTPException(status_code=403, detail="forbidden")


@router.post("/voice/intent")
def parse_voice_intent(
    payload: VoiceIntentRequest,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    _ensure_v2_schema_ready()
    trace_id = _normalize_trace_id(x_trace_id or payload.traceId)
    parsed = parse_voice_intent_text(payload.text)
    _maybe_insert_voice_intent_log(trace_id, None, payload.text, parsed)
    return {
        "destination": parsed.get("destination"),
        "days": parsed.get("days", 3),
        "budget": parsed.get("budget"),
        "preferences": parsed.get("preferences", []),
        "traceId": trace_id,
    }


@router.post("/recommend/videos")
async def recommend_videos(
    payload: RecommendVideosRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
):
    require_internal_caller(request, x_internal_token)
    _ensure_embedding_contract(payload.embeddingModel, payload.embeddingVersion, payload.embeddingDim)
    trace_id = _normalize_trace_id(x_trace_id or payload.traceId)
    try:
        computed = await asyncio.wait_for(
            asyncio.to_thread(_compute_recommendations, payload, trace_id, False),
            timeout=max(0.5, V2_RECOMMEND_SYNC_TIMEOUT_SEC),
        )
        items = computed.get("items", [])
        if len(items) >= payload.limit:
            return {"status": "completed", "result": computed, "traceId": trace_id}
    except asyncio.TimeoutError:
        pass
    except ValueError:
        pass

    job_id = _create_pipeline_job("recommend_videos", trace_id, payload.model_dump())
    background_tasks.add_task(_run_recommend_job, job_id)
    return JSONResponse(
        status_code=202,
        content={"jobId": job_id, "pollAfterMs": V2_JOB_POLL_AFTER_MS, "traceId": trace_id},
    )


@router.post("/recommend/jobs")
def create_recommend_job(
    payload: RecommendVideosRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    _ensure_embedding_contract(payload.embeddingModel, payload.embeddingVersion, payload.embeddingDim)
    trace_id = _normalize_trace_id(x_trace_id or payload.traceId)
    job_id = _create_pipeline_job("recommend_videos", trace_id, payload.model_dump())
    background_tasks.add_task(_run_recommend_job, job_id)
    return {"jobId": job_id, "pollAfterMs": V2_JOB_POLL_AFTER_MS, "traceId": trace_id}


@router.get("/recommend/jobs/{job_id}")
def get_recommend_job(
    job_id: str,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    job = _get_pipeline_job(job_id, ["recommend_videos"])
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "jobId": str(job["id"]),
        "status": job.get("status"),
        "result": job.get("result_json") if job.get("status") == "completed" else None,
        "traceId": job.get("trace_id"),
        "createdAt": _coerce_iso(job.get("created_at")),
        "updatedAt": _coerce_iso(job.get("updated_at")),
    }


@router.post("/trips/plan-from-intent")
async def plan_from_intent(
    payload: PlanFromIntentRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
):
    require_internal_caller(request, x_internal_token)
    _ensure_embedding_contract(payload.embeddingModel, payload.embeddingVersion, payload.embeddingDim)
    trace_id = _normalize_trace_id(x_trace_id or payload.traceId)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_compute_plan, payload, trace_id, False),
            timeout=max(0.5, V2_PLAN_SYNC_TIMEOUT_SEC),
        )
        return {"status": "completed", "result": result, "traceId": trace_id}
    except asyncio.TimeoutError:
        pass
    except ValueError:
        pass

    job_id = _create_pipeline_job("plan_from_intent", trace_id, payload.model_dump())
    background_tasks.add_task(_run_plan_job, job_id)
    return JSONResponse(
        status_code=202,
        content={"jobId": job_id, "pollAfterMs": V2_JOB_POLL_AFTER_MS, "traceId": trace_id},
    )


@router.post("/trips/plan-jobs")
def create_plan_job(
    payload: PlanFromIntentRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
    x_trace_id: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    _ensure_embedding_contract(payload.embeddingModel, payload.embeddingVersion, payload.embeddingDim)
    trace_id = _normalize_trace_id(x_trace_id or payload.traceId)
    job_id = _create_pipeline_job("plan_from_intent", trace_id, payload.model_dump())
    background_tasks.add_task(_run_plan_job, job_id)
    return {"jobId": job_id, "pollAfterMs": V2_JOB_POLL_AFTER_MS, "traceId": trace_id}


@router.get("/trips/plan-jobs/{job_id}")
def get_plan_job(
    job_id: str,
    request: Request,
    x_internal_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    require_internal_caller(request, x_internal_token)
    job = _get_pipeline_job(job_id, ["plan_from_intent"])
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "jobId": str(job["id"]),
        "status": job.get("status"),
        "result": job.get("result_json") if job.get("status") == "completed" else None,
        "traceId": job.get("trace_id"),
        "createdAt": _coerce_iso(job.get("created_at")),
        "updatedAt": _coerce_iso(job.get("updated_at")),
    }
