from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from .common import ToolResult, make_tool_result


async def search_youtube_videos(
    query: str,
    location: Optional[str],
    max_results: int,
    youtube_api_key: str,
) -> ToolResult:
    if not youtube_api_key:
        return make_tool_result(ok=False, source="youtube", error="missing YOUTUBE_API_KEY")
    q = (query or "").strip()
    if not q:
        return make_tool_result(ok=False, source="youtube", error="query is required")
    location_text = (location or "").strip()
    full_query = f"{q} 旅遊 {location_text}".strip()
    top_n = max(1, min(10, int(max_results or 5)))
    params: Dict[str, Any] = {
        "part": "snippet",
        "q": full_query,
        "type": "video",
        "maxResults": top_n,
        "key": youtube_api_key,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        response = await client.get("https://www.googleapis.com/youtube/v3/search", params=params)
    if response.status_code >= 400:
        return make_tool_result(ok=False, source="youtube", error=f"youtube api error: {response.status_code}")
    payload = response.json() if response.content else {}
    rows = payload.get("items") if isinstance(payload, dict) else []
    videos = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            snippet = row.get("snippet") if isinstance(row.get("snippet"), dict) else {}
            identifier = row.get("id") if isinstance(row.get("id"), dict) else {}
            video_id = identifier.get("videoId")
            if not isinstance(video_id, str) or not video_id:
                continue
            videos.append(
                {
                    "title": snippet.get("title") or "",
                    "video_id": video_id,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "description": snippet.get("description") or "",
                    "channel": snippet.get("channelTitle") or "",
                }
            )
    return make_tool_result(ok=True, source="youtube", data={"query": full_query, "videos": videos})
