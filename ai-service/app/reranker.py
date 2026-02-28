from __future__ import annotations

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


def rerank_candidates(
    candidates: List[RecommendationCandidate],
    keywords: List[str],
    preferred_cities: Set[str],
    budget_pref: str,
    pace_pref: str,
    constraints: List[str],
    interaction_scores: Optional[Dict[str, float]] = None,
    limit: int = 5,
) -> List[ScoredRecommendation]:
    now = datetime.now(timezone.utc)
    results: List[ScoredRecommendation] = []

    for candidate in candidates:
        score = 1.0
        reasons: List[str] = []
        breakdown: Dict[str, float] = {}
        concat_text = f"{candidate.title} {candidate.summary} {candidate.description} {candidate.city}"

        city_score = 0.0
        if candidate.city and candidate.city in preferred_cities:
            city_score = 1.2
            reasons.append(f"符合你偏好的城市「{candidate.city}」")
        breakdown["city_match"] = city_score
        score += city_score

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

        if not reasons:
            reasons.append("與你的搜尋主題相關")

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


def scored_to_response(items: List[ScoredRecommendation]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for idx, scored in enumerate(items):
        c = scored.candidate
        entry: Dict[str, Any] = {
            "video_id": c.video_id,
            "youtube_id": c.youtube_id,
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
