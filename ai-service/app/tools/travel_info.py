from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from .common import ToolResult, make_tool_result


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
            }
        )


async def search_travel_information(query: str, region: Optional[str], limit: int) -> ToolResult:
    q = (query or "").strip()
    if not q:
        return make_tool_result(ok=False, source="duckduckgo", error="query is required")
    region_text = (region or "").strip()
    full_query = f"{q} {region_text}".strip() if region_text else q
    top_n = max(1, min(8, int(limit or 5)))
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
        return make_tool_result(ok=False, source="duckduckgo", error=f"search api error: {response.status_code}")

    data = response.json() if response.content else {}
    results: List[Dict[str, str]] = []
    abstract_text = (data.get("AbstractText") or "").strip()
    abstract_url = (data.get("AbstractURL") or "").strip()
    heading = (data.get("Heading") or "").strip()
    if abstract_text:
        results.append({"title": heading or full_query, "snippet": abstract_text[:300], "url": abstract_url})
    _flatten_duckduckgo_related_topics(data.get("RelatedTopics"), results, top_n)
    return make_tool_result(
        ok=True,
        source="duckduckgo",
        data={"query": full_query, "results": results[:top_n], "fetched_at": datetime.utcnow().isoformat() + "Z"},
    )
