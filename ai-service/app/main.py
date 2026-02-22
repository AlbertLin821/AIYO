from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from psycopg.rows import dict_row


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


class PlanItineraryRequest(BaseModel):
    days: int = Field(default=1, ge=1, le=14)
    preferences: List[str] = Field(default_factory=list)
    segments: List[Dict[str, Any]] = Field(default_factory=list)


class SearchSegmentsRequest(BaseModel):
    query: str = Field(min_length=1)
    city: Optional[str] = None
    limit: int = Field(default=10, ge=1, le=50)
    embedding_model: Optional[str] = None


def get_env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


DATABASE_URL = get_env("DATABASE_URL", "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db")
OLLAMA_BASE_URL = get_env("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = get_env("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_EMBED_MODEL = get_env("OLLAMA_EMBED_MODEL", "nomic-embed-text")

app = FastAPI(title="AIYO ai-service", version="0.1.0")


def get_conn() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


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
    if not profile and not memories:
        return ""

    lines: List[str] = []
    if profile:
        lines.append("使用者偏好檔：")
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
        lines.append("近期記憶：")
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


def get_recommended_videos(
    query: str,
    city: Optional[str],
    user_id: Optional[int],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    signals = get_user_personalization_signals(user_id)
    city_filter = ""
    params: List[Any] = []
    if city:
        city_filter = "AND s.city = %s"
        params.append(city)

    params.extend([f"%{query}%", f"%{query}%", f"%{query}%"])
    ranked = fetch_all(
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
    by_video: Dict[int, Dict[str, Any]] = {}
    keyword_list: List[str] = signals["keywords"]
    preferred_cities = signals["preferred_cities"]
    budget_pref = signals["budget_pref"]
    pace_pref = signals["pace_pref"]

    for row in ranked:
        video_id = int(row["video_id"])
        summary_text = (row.get("summary") or "").strip()
        tags_text = json.dumps(row.get("tags") or {}, ensure_ascii=False)
        title_text = (row.get("title") or "").strip()
        concat_text = f"{title_text} {summary_text} {tags_text}"
        score = 1.0

        if preferred_cities and row.get("city") in preferred_cities:
            score += 0.9

        kw_hits = 0
        for kw in keyword_list:
            if kw and kw in concat_text:
                kw_hits += 1
        score += min(1.6, kw_hits * 0.2)

        if budget_pref:
            if budget_pref in ["低", "小資", "省錢"] and any(word in concat_text for word in ["平價", "便宜", "小吃"]):
                score += 0.6
            if budget_pref in ["高", "奢華"] and any(word in concat_text for word in ["高級", "精品", "五星"]):
                score += 0.6

        if pace_pref:
            if pace_pref in ["慢", "輕鬆"] and any(word in concat_text for word in ["散步", "慢遊", "悠閒"]):
                score += 0.35
            if pace_pref in ["快", "緊湊"] and any(word in concat_text for word in ["一日", "快速", "必去"]):
                score += 0.35

        if video_id not in by_video:
            by_video[video_id] = {
                "video_id": video_id,
                "youtube_id": row.get("youtube_id"),
                "title": row.get("title"),
                "channel": row.get("channel"),
                "duration": row.get("duration"),
                "city": row.get("city"),
                "thumbnail_url": f"https://i.ytimg.com/vi/{row.get('youtube_id')}/mqdefault.jpg",
                "summary": row.get("summary") or "",
                "segments": [],
                "rank_score": 0.0,
                "latest_segment_created_at": row.get("created_at"),
            }
        item = by_video[video_id]
        item["rank_score"] += score
        if row.get("created_at") and (not item.get("latest_segment_created_at") or row.get("created_at") > item.get("latest_segment_created_at")):
            item["latest_segment_created_at"] = row.get("created_at")
        if len(item["segments"]) < 5:
            item["segments"].append(
                {
                    "segment_id": row.get("segment_id"),
                    "start_sec": row.get("start_sec"),
                    "end_sec": row.get("end_sec"),
                    "summary": row.get("summary"),
                    "tags": row.get("tags"),
                }
            )

    items = sorted(
        by_video.values(),
        key=lambda x: (x.get("rank_score") or 0, x.get("latest_segment_created_at")),
        reverse=True,
    )[:limit]
    return items


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
def plan_itinerary(payload: PlanItineraryRequest) -> Dict[str, Any]:
    # MVP: 先用簡單切分策略，後續再加入地圖路徑與時間優化
    result_days: List[Dict[str, Any]] = [{"day": idx + 1, "segments": []} for idx in range(payload.days)]
    for index, segment in enumerate(payload.segments):
        day_idx = index % payload.days
        result_days[day_idx]["segments"].append(segment)

    return {
        "days": payload.days,
        "preferences": payload.preferences,
        "itinerary": result_days,
    }


@app.post("/api/tools/search-segments")
async def search_segments(payload: SearchSegmentsRequest) -> Dict[str, Any]:
    return await search_segments_internal(payload.query, payload.city, payload.limit, payload.embedding_model)


@app.post("/api/chat")
async def chat(payload: ChatRequest):
    model = payload.model or OLLAMA_MODEL
    safe_history = [m for m in payload.messages if m.content.strip()]
    if not safe_history or safe_history[-1].content != payload.message:
        safe_history.append(ChatMessage(role="user", content=payload.message))

    rag = await search_segments_internal(
        query=payload.message,
        city=payload.city,
        limit=5,
        embedding_model=None,
    )
    rag_items = rag.get("items") or []
    rag_context = build_rag_context(rag_items)
    user_profile_context = build_user_profile_context(payload.user_id)
    recommended_videos = get_recommended_videos(payload.message, payload.city, payload.user_id, limit=5)

    system_text = "你是 AIYO 旅遊助理。請全程使用繁體中文回覆，並避免使用簡體中文。"
    if user_profile_context:
        system_text += (
            "\n\n以下是使用者的偏好與記憶資料，請優先用於個人化建議：\n"
            f"{user_profile_context}\n"
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
        if payload.stream:
            upstream = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={"model": model, "stream": True, "messages": messages},
            )
            if upstream.status_code >= 400:
                return JSONResponse(
                    {"error": f"ollama error: {upstream.status_code}", "detail": upstream.text},
                    status_code=502,
                )

            async def event_stream():
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
                        yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
                    if chunk.get("done"):
                        yield (
                            "data: "
                            + json.dumps(
                                {"done": True, "recommended_videos": recommended_videos},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )

            return StreamingResponse(event_stream(), media_type="text/event-stream")

        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={"model": model, "stream": False, "messages": messages},
        )
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"ollama error: {response.status_code}")
        data = response.json()
        text = (data.get("message") or {}).get("content") or ""
        return {"reply": text, "recommended_videos": recommended_videos}
