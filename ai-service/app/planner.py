from __future__ import annotations

import math
import urllib.parse
import urllib.request
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class PlannerSlot:
    place_name: str
    place_id: Optional[int] = None
    segment_id: Optional[int] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    category: str = ""
    stay_minutes: int = 60
    estimated_cost: float = 0.0
    time_start: str = ""
    time_end: str = ""
    travel_minutes_from_prev: int = 0
    travel_mode: str = "transit"
    travel_time_source: str = "heuristic"
    notes: List[str] = field(default_factory=list)


@dataclass
class PlannerDay:
    day_number: int
    date_label: str = ""
    slots: List[PlannerSlot] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    total_cost: float = 0.0
    total_travel_minutes: int = 0


@dataclass
class PlannerConstraints:
    budget_total: Optional[float] = None
    budget_per_day: Optional[float] = None
    pace: str = ""
    transport_pref: str = ""
    must_visit: List[str] = field(default_factory=list)
    avoid: List[str] = field(default_factory=list)
    dietary: str = ""
    day_start_hour: int = 9
    day_end_hour: int = 21
    max_travel_minutes_per_leg: int = 90
    google_maps_api_key: str = ""


@dataclass
class PlannerResult:
    days: List[PlannerDay] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    feasible: bool = True
    total_cost: float = 0.0
    must_visit_missing: List[str] = field(default_factory=list)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def estimate_travel_minutes(distance_km: float, mode: str) -> int:
    speeds = {"drive": 40, "transit": 25, "walk": 4.5, "bike": 12}
    speed = speeds.get(mode, 25)
    overhead = {"drive": 5, "transit": 15, "walk": 2, "bike": 3}.get(mode, 10)
    return max(5, int((distance_km / speed) * 60) + overhead)


def _to_google_mode(mode: str) -> str:
    mapping = {
        "drive": "driving",
        "transit": "transit",
        "walk": "walking",
        "bike": "bicycling",
    }
    return mapping.get(mode, "transit")


def fetch_google_directions_minutes(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
    mode: str,
    api_key: str,
    timeout_sec: float = 3.0,
) -> Optional[int]:
    key = (api_key or "").strip()
    if not key:
        return None
    query = urllib.parse.urlencode(
        {
            "origin": f"{lat1},{lng1}",
            "destination": f"{lat2},{lng2}",
            "mode": _to_google_mode(mode),
            "key": key,
            "language": "zh-TW",
        }
    )
    url = f"https://maps.googleapis.com/maps/api/directions/json?{query}"
    try:
        with urllib.request.urlopen(url, timeout=timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    routes = payload.get("routes")
    if not isinstance(routes, list) or not routes:
        return None
    first_route = routes[0] if isinstance(routes[0], dict) else {}
    legs = first_route.get("legs")
    if not isinstance(legs, list) or not legs:
        return None
    first_leg = legs[0] if isinstance(legs[0], dict) else {}
    duration = first_leg.get("duration") if isinstance(first_leg.get("duration"), dict) else {}
    value = duration.get("value")
    if not isinstance(value, (int, float)):
        return None
    return max(1, int(round(float(value) / 60.0)))


def _pace_to_slots_per_day(pace: str) -> int:
    if pace in ("慢", "輕鬆"):
        return 3
    if pace in ("快", "緊湊"):
        return 6
    return 4


def _assign_time_labels(slots: List[PlannerSlot], start_hour: int, end_hour: int) -> None:
    current_minutes = start_hour * 60
    for slot in slots:
        current_minutes += slot.travel_minutes_from_prev
        slot.time_start = f"{current_minutes // 60:02d}:{current_minutes % 60:02d}"
        current_minutes += slot.stay_minutes
        slot.time_end = f"{current_minutes // 60:02d}:{current_minutes % 60:02d}"


def plan_itinerary_v2(
    segments: List[Dict[str, Any]],
    days_count: int,
    constraints: PlannerConstraints,
    preferences: List[str],
) -> PlannerResult:
    max_per_day = _pace_to_slots_per_day(constraints.pace)
    transport_mode = constraints.transport_pref or "transit"

    filtered = []
    for seg in segments:
        name = (seg.get("place_name") or seg.get("name") or "").strip()
        if not name:
            continue
        if constraints.avoid and any(avoid.lower() in name.lower() for avoid in constraints.avoid):
            continue
        filtered.append(seg)

    must_visit_set = set(m.lower() for m in constraints.must_visit)
    placed_must_visit: Set[str] = set()

    result_days: List[PlannerDay] = []
    seg_index = 0
    total_cost = 0.0
    global_warnings: List[str] = []

    for day_num in range(1, days_count + 1):
        day = PlannerDay(day_number=day_num)
        day_cost = 0.0

        slots_this_day: List[PlannerSlot] = []

        for _ in range(max_per_day):
            if seg_index >= len(filtered):
                break
            seg = filtered[seg_index]
            seg_index += 1

            name = (seg.get("place_name") or seg.get("name") or "").strip()
            cost = float(seg.get("estimated_cost") or seg.get("cost") or 0)
            stay = int(seg.get("stay_minutes") or seg.get("stay") or 60)
            lat = seg.get("lat")
            lng = seg.get("lng")

            if constraints.budget_per_day and (day_cost + cost) > constraints.budget_per_day:
                day.warnings.append(f"「{name}」超出每日預算，已略過")
                continue

            slot = PlannerSlot(
                place_name=name,
                place_id=seg.get("place_id"),
                segment_id=seg.get("segment_id"),
                lat=float(lat) if isinstance(lat, (int, float)) else None,
                lng=float(lng) if isinstance(lng, (int, float)) else None,
                category=str(seg.get("category") or ""),
                stay_minutes=stay,
                estimated_cost=cost,
                travel_mode=transport_mode,
            )

            if slots_this_day and slot.lat and slot.lng:
                prev = slots_this_day[-1]
                if prev.lat and prev.lng:
                    dist = haversine_km(prev.lat, prev.lng, slot.lat, slot.lng)
                    travel = estimate_travel_minutes(dist, transport_mode)
                    source = "heuristic"
                    if constraints.google_maps_api_key:
                        directions_minutes = fetch_google_directions_minutes(
                            prev.lat,
                            prev.lng,
                            slot.lat,
                            slot.lng,
                            transport_mode,
                            constraints.google_maps_api_key,
                        )
                        if directions_minutes is not None:
                            travel = directions_minutes
                            source = "directions_api"
                    slot.travel_minutes_from_prev = travel
                    slot.travel_time_source = source
                    if travel > constraints.max_travel_minutes_per_leg:
                        slot.notes.append(f"交通時間 {travel} 分鐘，超過建議上限 {constraints.max_travel_minutes_per_leg} 分鐘")
                        day.warnings.append(f"「{prev.place_name}」到「{name}」交通時間過長（{travel} 分鐘）")

            day_cost += cost
            slots_this_day.append(slot)

            if name.lower() in must_visit_set:
                placed_must_visit.add(name.lower())

        _assign_time_labels(slots_this_day, constraints.day_start_hour, constraints.day_end_hour)

        if slots_this_day:
            last_end = slots_this_day[-1].time_end
            end_minutes = int(last_end.split(":")[0]) * 60 + int(last_end.split(":")[1])
            if end_minutes > constraints.day_end_hour * 60:
                overflow = end_minutes - constraints.day_end_hour * 60
                day.warnings.append(f"當日行程超出結束時間 {overflow} 分鐘，建議減少景點或縮短停留")

        day.slots = slots_this_day
        day.total_cost = day_cost
        day.total_travel_minutes = sum(s.travel_minutes_from_prev for s in slots_this_day)
        total_cost += day_cost
        result_days.append(day)

    must_visit_missing = [m for m in constraints.must_visit if m.lower() not in placed_must_visit]
    if must_visit_missing:
        global_warnings.append(f"以下必去景點未能排入行程：{'、'.join(must_visit_missing)}")

    if constraints.budget_total and total_cost > constraints.budget_total:
        global_warnings.append(f"總費用 {total_cost:.0f} 元超過預算 {constraints.budget_total:.0f} 元")

    feasible = not global_warnings and all(not d.warnings for d in result_days)

    return PlannerResult(
        days=result_days,
        warnings=global_warnings,
        feasible=feasible,
        total_cost=total_cost,
        must_visit_missing=must_visit_missing,
    )


def planner_result_to_response(result: PlannerResult) -> Dict[str, Any]:
    return {
        "feasible": result.feasible,
        "total_cost": result.total_cost,
        "warnings": result.warnings,
        "must_visit_missing": result.must_visit_missing,
        "days": [
            {
                "day_number": day.day_number,
                "date_label": day.date_label,
                "total_cost": day.total_cost,
                "total_travel_minutes": day.total_travel_minutes,
                "warnings": day.warnings,
                "slots": [
                    {
                        "place_name": slot.place_name,
                        "place_id": slot.place_id,
                        "segment_id": slot.segment_id,
                        "category": slot.category,
                        "stay_minutes": slot.stay_minutes,
                        "estimated_cost": slot.estimated_cost,
                        "time_start": slot.time_start,
                        "time_end": slot.time_end,
                        "travel_minutes_from_prev": slot.travel_minutes_from_prev,
                        "travel_mode": slot.travel_mode,
                        "travel_time_source": slot.travel_time_source,
                        "lat": slot.lat,
                        "lng": slot.lng,
                        "notes": slot.notes,
                    }
                    for slot in day.slots
                ],
            }
            for day in result.days
        ],
    }
