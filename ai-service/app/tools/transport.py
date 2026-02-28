from __future__ import annotations

from typing import Optional

from .common import ToolResult, make_tool_result
from .travel_info import search_travel_information


async def search_transport_options(
    departure: str,
    destination: str,
    budget: Optional[float],
    limit: int = 5,
) -> ToolResult:
    from_text = (departure or "").strip()
    to_text = (destination or "").strip()
    if not from_text or not to_text:
        return make_tool_result(ok=False, source="transport-search", error="departure and destination are required")
    budget_text = f" 預算 {int(budget)} 元" if isinstance(budget, (int, float)) else ""
    query = f"{from_text} 到 {to_text} 大眾運輸 路線 票價{budget_text}"
    result = await search_travel_information(query=query, region=None, limit=limit)
    if not result.get("ok"):
        return make_tool_result(ok=False, source="transport-search", error=result.get("error"))
    return make_tool_result(
        ok=True,
        source="transport-search",
        data={
            "departure": from_text,
            "destination": to_text,
            "budget": budget,
            "results": (result.get("data") or {}).get("results", []),
        },
    )
