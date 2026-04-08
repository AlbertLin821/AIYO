from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

import httpx

from .common import ToolResult, make_tool_result


def is_weather_query(text: str) -> bool:
    normalized = (text or "").lower()
    weather_keywords = ["天氣", "氣溫", "溫度", "降雨", "下雨", "weather", "forecast", "rain", "temperature"]
    return any(token.lower() in normalized for token in weather_keywords)


async def get_current_time(timezone: str, default_timezone: str) -> ToolResult:
    timezone_name = (timezone or default_timezone).strip() or default_timezone
    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        timezone_name = default_timezone
        zone = ZoneInfo(timezone_name)
    now = datetime.now(zone)
    return make_tool_result(
        ok=True,
        source="local-time",
        data={
            "timezone": timezone_name,
            "iso": now.isoformat(),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "weekday": now.strftime("%A"),
            "unix": int(now.timestamp()),
        },
    )


async def resolve_region_from_coordinates(lat: float, lng: float, user_agent: str) -> Optional[str]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"format": "jsonv2", "lat": lat, "lon": lng, "accept-language": "zh-TW"},
            headers={"User-Agent": user_agent},
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


async def infer_weather_region(
    explicit_region: Optional[str],
    query: str,
    user_ai_settings: Dict[str, Any],
    default_region: Optional[str],
    user_agent: str,
) -> Dict[str, str]:
    region = (explicit_region or "").strip()
    if region:
        return {"region": region, "location_source": "tool_argument"}

    if not is_weather_query(query):
        if default_region and default_region.strip():
            return {"region": default_region.strip(), "location_source": "default_region"}
        return {"region": "", "location_source": "none"}

    tool_policy = user_ai_settings.get("tool_policy_json") if isinstance(user_ai_settings, dict) else {}
    allow_current_location = True
    if isinstance(tool_policy, dict) and tool_policy.get("weather_use_current_location") is False:
        allow_current_location = False
    if user_ai_settings.get("auto_use_current_location") is False:
        allow_current_location = False

    if allow_current_location:
        current_region = user_ai_settings.get("current_region")
        if isinstance(current_region, str) and current_region.strip():
            return {"region": current_region.strip(), "location_source": "current_region"}
        lat = user_ai_settings.get("current_lat")
        lng = user_ai_settings.get("current_lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            resolved = await resolve_region_from_coordinates(float(lat), float(lng), user_agent)
            if resolved:
                return {"region": resolved, "location_source": "reverse_geocode"}

    weather_default_region = user_ai_settings.get("weather_default_region")
    if isinstance(weather_default_region, str) and weather_default_region.strip():
        return {"region": weather_default_region.strip(), "location_source": "weather_default_region"}

    if default_region and default_region.strip():
        return {"region": default_region.strip(), "location_source": "default_region"}

    return {"region": "", "location_source": "none"}


def _parse_geocode_result(lat: float, lng: float, name: str, country: str) -> Optional[Dict[str, Any]]:
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    return {"latitude": lat, "longitude": lng, "name": name or "", "country": country or ""}


async def _geocode_region_nominatim(region: str, user_agent: str) -> Optional[Dict[str, Any]]:
    """當 Open-Meteo 無結果時使用 Nominatim 解析地名（支援日文等，如熊本）。"""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": region, "format": "json", "limit": 1},
            headers={"User-Agent": user_agent},
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
    return _parse_geocode_result(lat, lng, name, country)


async def get_weather(region: str, user_agent: str, query: str, location_source: str) -> ToolResult:
    if not region.strip():
        return make_tool_result(
            ok=False,
            source="open-meteo",
            error="missing region",
            data={"query": query, "location_source": location_source},
        )
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
        geo = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": region, "count": 1, "language": "zh", "format": "json"},
            headers={"User-Agent": user_agent},
        )
        if geo.status_code >= 400:
            return make_tool_result(ok=False, source="open-meteo", error=f"geocoding error: {geo.status_code}")
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
            nominatim = await _geocode_region_nominatim(region, user_agent)
            if not nominatim:
                return make_tool_result(ok=False, source="open-meteo", error="geocoding no result")
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
            headers={"User-Agent": user_agent},
        )
    if weather.status_code >= 400:
        return make_tool_result(ok=False, source="open-meteo", error=f"weather api error: {weather.status_code}")
    weather_data = weather.json() if weather.content else {}
    return make_tool_result(
        ok=True,
        source="open-meteo",
        data={
            "query": query,
            "region": region,
            "resolved_name": resolved_name,
            "country": country,
            "timezone": weather_data.get("timezone"),
            "current": (weather_data.get("current") or {}),
            "location_source": location_source,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        },
    )
