from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class UserFeatures:
    user_id: int
    display_name: str = ""
    travel_style: str = ""
    budget_pref: str = ""
    pace_pref: str = ""
    transport_pref: str = ""
    dietary_pref: str = ""
    preferred_cities: Set[str] = field(default_factory=set)
    interests: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    memory_facts: List[str] = field(default_factory=list)
    current_region: str = ""
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None
    weather_default_region: str = ""
    auto_use_current_location: bool = True
    tool_policy_enabled: bool = True


def merge_user_features(
    user_id: int,
    profile: Optional[Dict[str, Any]],
    memories: List[Dict[str, Any]],
    preferences_json: Optional[Dict[str, Any]],
    ai_settings: Optional[Dict[str, Any]],
) -> UserFeatures:
    features = UserFeatures(user_id=user_id)

    if isinstance(profile, dict):
        features.display_name = _str(profile.get("display_name"))
        features.travel_style = _str(profile.get("travel_style"))
        features.budget_pref = _str(profile.get("budget_pref"))
        features.pace_pref = _str(profile.get("pace_pref"))
        features.transport_pref = _str(profile.get("transport_pref"))
        features.dietary_pref = _str(profile.get("dietary_pref"))
        cities = profile.get("preferred_cities")
        if isinstance(cities, list):
            for city in cities:
                if isinstance(city, str) and city.strip():
                    features.preferred_cities.add(city.strip())

    if isinstance(preferences_json, dict):
        for city in (preferences_json.get("preferred_cities") or []):
            if isinstance(city, str) and city.strip():
                features.preferred_cities.add(city.strip())
        for like in (preferences_json.get("travel_likes") or []):
            if isinstance(like, str) and like.strip():
                features.interests.append(like.strip())
        for constraint in (preferences_json.get("constraints") or []):
            if isinstance(constraint, str) and constraint.strip():
                features.constraints.append(constraint.strip())
        if not features.budget_pref:
            features.budget_pref = _str(preferences_json.get("budget"))
        if not features.pace_pref:
            features.pace_pref = _str(preferences_json.get("pace"))
        if not features.transport_pref:
            features.transport_pref = _str(preferences_json.get("transport"))

    for mem in memories:
        text = _str(mem.get("memory_text"))
        if text:
            features.memory_facts.append(text)
            mem_type = _str(mem.get("memory_type"))
            if mem_type in ("preferred_city", "visited_city"):
                features.preferred_cities.add(text)

    if isinstance(ai_settings, dict):
        features.current_region = _str(ai_settings.get("current_region"))
        lat = ai_settings.get("current_lat")
        lng = ai_settings.get("current_lng")
        if isinstance(lat, (int, float)):
            features.current_lat = float(lat)
        if isinstance(lng, (int, float)):
            features.current_lng = float(lng)
        features.weather_default_region = _str(ai_settings.get("weather_default_region"))
        features.auto_use_current_location = bool(ai_settings.get("auto_use_current_location", True))
        tool_policy = ai_settings.get("tool_policy_json")
        if isinstance(tool_policy, dict):
            features.tool_policy_enabled = bool(tool_policy.get("enabled", True))

    return features


def features_to_keywords(features: UserFeatures, limit: int = 30) -> List[str]:
    raw: List[str] = []
    if features.travel_style:
        raw.extend(features.travel_style.replace(",", " ").split())
    raw.extend(features.interests)
    for fact in features.memory_facts:
        raw.extend(word for word in fact.replace(",", " ").split() if len(word) >= 2)
    seen: Set[str] = set()
    result: List[str] = []
    for word in raw:
        word = word.strip()
        if word and word not in seen:
            seen.add(word)
            result.append(word)
        if len(result) >= limit:
            break
    return result


def features_to_scoring_context(features: UserFeatures) -> Dict[str, Any]:
    return {
        "keywords": features_to_keywords(features),
        "preferred_cities": features.preferred_cities,
        "budget_pref": features.budget_pref,
        "pace_pref": features.pace_pref,
        "transport_pref": features.transport_pref,
        "dietary_pref": features.dietary_pref,
        "constraints": features.constraints,
        "current_region": features.current_region,
    }


def features_to_system_context(features: UserFeatures) -> str:
    lines: List[str] = []
    if features.display_name:
        lines.append(f"使用者名稱：{features.display_name}")
    if features.travel_style:
        lines.append(f"旅遊風格：{features.travel_style}")
    if features.budget_pref:
        lines.append(f"預算偏好：{features.budget_pref}")
    if features.pace_pref:
        lines.append(f"行程節奏：{features.pace_pref}")
    if features.transport_pref:
        lines.append(f"交通偏好：{features.transport_pref}")
    if features.dietary_pref:
        lines.append(f"飲食偏好：{features.dietary_pref}")
    if features.preferred_cities:
        lines.append(f"偏好城市：{'、'.join(sorted(features.preferred_cities))}")
    if features.interests:
        lines.append(f"興趣：{'、'.join(features.interests[:12])}")
    if features.constraints:
        lines.append(f"限制/避免：{'、'.join(features.constraints[:8])}")
    if features.memory_facts:
        lines.append("記憶事實：")
        for fact in features.memory_facts[:10]:
            lines.append(f"  - {fact[:150]}")
    if features.current_region:
        lines.append(f"目前所在地區：{features.current_region}")
    return "\n".join(lines)


def _str(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""
