from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set


@dataclass
class RecommendationCandidate:
    source: str
    video_id: Optional[int] = None
    youtube_id: str = ""
    title: str = ""
    channel: str = ""
    duration: Optional[int] = None
    city: str = ""
    thumbnail_url: str = ""
    summary: str = ""
    description: str = ""
    linked_place_names: str = ""
    segments: List[Dict[str, Any]] = field(default_factory=list)
    created_at: Optional[datetime] = None
    raw_score: float = 0.0


@dataclass
class ScoredRecommendation:
    candidate: RecommendationCandidate
    final_score: float = 0.0
    reasons: List[str] = field(default_factory=list)
    score_breakdown: Dict[str, float] = field(default_factory=dict)


def _text_match_count(keywords: List[str], text: str) -> int:
    lower_text = text.lower()
    return sum(1 for kw in keywords if kw and kw.lower() in lower_text)


def _freshness_score(created_at: Optional[datetime], now: datetime) -> float:
    if not created_at:
        return 0.0
    try:
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_days = max(0, (now - created_at).total_seconds() / 86400)
    except Exception:
        return 0.0
    return max(0.0, 1.0 - (age_days / 365.0))


def _place_name_match_score(
    place_names: List[str],
    title: str,
    summary: str,
    linked_places: str,
) -> tuple[float, List[str], str]:
    """景點名稱為最高優先：標題命中 +5、摘要或關聯景點 +3、皆無則 -2。"""
    cleaned = [p.strip() for p in place_names if p and len(p.strip()) >= 2]
    if not cleaned:
        return 0.0, [], "skipped"

    t = (title or "").lower()
    s = f"{summary or ''} {linked_places or ''}".lower()
    matched_title: List[str] = []
    matched_body: List[str] = []
    for name in cleaned:
        n = name.lower()
        if n in t:
            matched_title.append(name)
        elif n in s:
            matched_body.append(name)

    if matched_title:
        return 5.0, [f"景點「{matched_title[0]}」出現在影片標題"], "title"
    if matched_body:
        return 3.0, [f"景點「{matched_body[0]}」出現在內容或關聯景點"], "summary_or_places"
    return -2.0, [], "miss"


def rerank_candidates(
    candidates: List[RecommendationCandidate],
    keywords: List[str],
    preferred_cities: Set[str],
    budget_pref: str,
    pace_pref: str,
    constraints: List[str],
    interaction_scores: Optional[Dict[str, float]] = None,
    query_text: Optional[str] = None,
    place_names: Optional[List[str]] = None,
    limit: int = 5,
) -> List[ScoredRecommendation]:
    now = datetime.now(timezone.utc)
    results: List[ScoredRecommendation] = []
    query_lower = (query_text or "").strip().lower()
    place_name_list = [p.strip() for p in (place_names or []) if p and len(p.strip()) >= 2]

    for candidate in candidates:
        score = 1.0
        reasons: List[str] = []
        breakdown: Dict[str, float] = {}
        concat_text = (
            f"{candidate.title} {candidate.summary} {candidate.description} {candidate.city} "
            f"{candidate.linked_place_names}"
        )

        place_nm = 0.0
        if place_name_list:
            place_nm, place_reasons, kind = _place_name_match_score(
                place_name_list,
                candidate.title,
                candidate.summary,
                candidate.linked_place_names,
            )
            breakdown["place_name_match"] = place_nm
            score += place_nm
            if place_reasons:
                reasons.extend(place_reasons)
            elif kind == "miss":
                reasons.append("與你關注的景點名稱在標題與內容中較少直接對應，已降權")

        city_score = 0.0
        if candidate.city and candidate.city in preferred_cities:
            city_score = 1.2
            reasons.append(f"符合你偏好的城市「{candidate.city}」")
        breakdown["city_match"] = city_score
        score += city_score

        query_location_score = 0.0
        if query_lower and candidate.city:
            cand_city = candidate.city.strip()
            if cand_city and cand_city.lower() in query_lower:
                query_location_score = 2.0
                reasons.append(f"與你指定的地點「{candidate.city}」相符")
            else:
                query_location_score = -0.8
        breakdown["query_location_match"] = query_location_score
        score += query_location_score

        kw_hits = _text_match_count(keywords, concat_text)
        kw_score = min(2.0, kw_hits * 0.25)
        if kw_hits > 0:
            matched = [kw for kw in keywords if kw and kw.lower() in concat_text.lower()][:3]
            reasons.append(f"內容包含你感興趣的「{'、'.join(matched)}」")
        breakdown["keyword_match"] = kw_score
        score += kw_score

        budget_score = 0.0
        if budget_pref:
            low_budget_words = ["平價", "便宜", "小吃", "銅板", "省錢", "小資"]
            high_budget_words = ["高級", "精品", "五星", "奢華", "米其林"]
            if budget_pref in ["低", "小資", "省錢"] and any(w in concat_text for w in low_budget_words):
                budget_score = 0.7
                reasons.append("符合你的平價預算偏好")
            elif budget_pref in ["高", "奢華"] and any(w in concat_text for w in high_budget_words):
                budget_score = 0.7
                reasons.append("符合你的高端預算偏好")
        breakdown["budget_match"] = budget_score
        score += budget_score

        pace_score = 0.0
        if pace_pref:
            slow_words = ["散步", "慢遊", "悠閒", "放鬆", "半日"]
            fast_words = ["一日", "快速", "必去", "緊湊", "攻略"]
            if pace_pref in ["慢", "輕鬆"] and any(w in concat_text for w in slow_words):
                pace_score = 0.4
                reasons.append("節奏輕鬆，適合你的慢旅偏好")
            elif pace_pref in ["快", "緊湊"] and any(w in concat_text for w in fast_words):
                pace_score = 0.4
                reasons.append("行程緊湊，適合你的快節奏偏好")
        breakdown["pace_match"] = pace_score
        score += pace_score

        penalty = 0.0
        if constraints:
            for constraint in constraints:
                if constraint and constraint.lower() in concat_text.lower():
                    penalty += 0.8
            penalty = min(2.0, penalty)
        breakdown["constraint_penalty"] = -penalty
        score -= penalty

        freshness = _freshness_score(candidate.created_at, now)
        breakdown["freshness"] = round(freshness * 0.3, 4)
        score += freshness * 0.3

        source_bonus = {"db_rag": 0.2, "youtube_api": 0.1}.get(candidate.source, 0.0)
        breakdown["source_bonus"] = source_bonus
        score += source_bonus

        if candidate.segments:
            seg_bonus = min(0.5, len(candidate.segments) * 0.1)
            breakdown["segment_richness"] = seg_bonus
            score += seg_bonus

        behavior_boost = 0.0
        if interaction_scores and candidate.youtube_id:
            raw_feedback = float(interaction_scores.get(candidate.youtube_id, 0.0))
            # 避免單一使用者事件量過大造成排序過度偏移。
            behavior_boost = max(-1.0, min(1.6, raw_feedback * 0.35))
            if behavior_boost > 0:
                reasons.append("你過去對相似影片有正向互動")
            elif behavior_boost < 0:
                reasons.append("近期互動顯示你可能較不偏好這類內容")
        breakdown["behavior_feedback"] = round(behavior_boost, 4)
        score += behavior_boost

        results.append(ScoredRecommendation(
            candidate=candidate,
            final_score=round(score, 4),
            reasons=reasons,
            score_breakdown=breakdown,
        ))

    results.sort(key=lambda r: r.final_score, reverse=True)
    return results[:limit]


def build_candidates_from_db_rows(rows: List[Dict[str, Any]]) -> List[RecommendationCandidate]:
    by_video: Dict[int, RecommendationCandidate] = {}
    for row in rows:
        vid = int(row.get("video_id", 0))
        if vid not in by_video:
            youtube_id = row.get("youtube_id") or ""
            by_video[vid] = RecommendationCandidate(
                source="db_rag",
                video_id=vid,
                youtube_id=youtube_id,
                title=row.get("title") or "",
                channel=row.get("channel") or "",
                duration=row.get("duration"),
                city=row.get("city") or "",
                thumbnail_url=f"https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg" if youtube_id else "",
                summary=row.get("summary") or "",
                linked_place_names=row.get("place_names") or "",
                created_at=row.get("created_at"),
            )
        c = by_video[vid]
        if len(c.segments) < 5:
            c.segments.append({
                "segment_id": row.get("segment_id"),
                "start_sec": row.get("start_sec"),
                "end_sec": row.get("end_sec"),
                "summary": row.get("summary"),
                "tags": row.get("tags"),
            })
    return list(by_video.values())


def build_candidates_from_youtube_api(items: List[Dict[str, Any]]) -> List[RecommendationCandidate]:
    candidates: List[RecommendationCandidate] = []
    for item in items:
        yt_id = item.get("video_id") or ""
        if not yt_id:
            continue
        candidates.append(RecommendationCandidate(
            source="youtube_api",
            youtube_id=yt_id,
            title=item.get("title") or "",
            channel=item.get("channel") or "",
            description=item.get("description") or "",
            thumbnail_url=f"https://i.ytimg.com/vi/{yt_id}/mqdefault.jpg",
        ))
    return candidates


def _stable_video_id_from_youtube(youtube_id: str) -> int:
    """Stable positive int for YouTube-only rows so clients can dedupe without colliding on 0."""
    if not youtube_id:
        return 0
    digest = hashlib.sha256(youtube_id.encode("utf-8")).digest()
    n = int.from_bytes(digest[:4], "big") & 0x7FFFFFFF
    return n if n != 0 else 1


def scored_to_response(items: List[ScoredRecommendation]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for idx, scored in enumerate(items):
        c = scored.candidate
        vid = c.video_id
        if vid is None or vid == 0:
            vid = _stable_video_id_from_youtube(c.youtube_id or "") if (c.youtube_id or "").strip() else 0
        entry: Dict[str, Any] = {
            "video_id": vid,
            "youtube_id": c.youtube_id or "",
            "title": c.title,
            "channel": c.channel,
            "duration": c.duration,
            "city": c.city,
            "thumbnail_url": c.thumbnail_url,
            "summary": c.summary or c.description,
            "segments": c.segments,
            "rank_position": idx + 1,
            "rank_score": scored.final_score,
            "recommendation_reasons": scored.reasons,
            "score_breakdown": scored.score_breakdown,
            "source": c.source,
        }
        result.append(entry)
    return result
