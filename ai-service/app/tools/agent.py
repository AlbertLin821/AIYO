from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx

from .common import ToolResult, make_tool_result, parse_tool_arguments
from .transport import search_transport_options
from .travel_info import search_travel_information
from .weather import get_current_time, get_weather, infer_weather_region, is_weather_query
from .youtube import search_youtube_videos

ToolHandler = Callable[[Dict[str, Any], Dict[str, Any]], Awaitable[ToolResult]]


async def _execute_with_retry(
    handler: ToolHandler,
    args: Dict[str, Any],
    context: Dict[str, Any],
    tool_name: str,
    max_retries: int = 2,
) -> ToolResult:
    last_error: Optional[Exception] = None
    for attempt in range(1 + max_retries):
        try:
            result = await handler(args, context)
            if result.get("ok") or attempt >= max_retries:
                return result
            error_text = result.get("error") or ""
            retryable = any(kw in error_text for kw in ("timeout", "5", "429", "connection"))
            if not retryable:
                return result
        except Exception as exc:
            last_error = exc
            if attempt >= max_retries:
                break
        await asyncio.sleep(0.5 * (attempt + 1))
    return make_tool_result(
        ok=False,
        source=tool_name,
        error=f"failed after {max_retries + 1} attempts: {type(last_error).__name__}: {last_error}" if last_error else "failed after retries",
    )


def _extract_weather_location(args: Dict[str, Any]) -> str:
    for key in ("location", "city", "region", "place", "area"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    nested_location = args.get("location")
    if isinstance(nested_location, dict):
        for key in ("name", "city", "region", "label"):
            value = nested_location.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def get_tool_schemas(flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    schemas: List[Dict[str, Any]] = [
        {
            "type": "function",
            "function": {
                "name": "get_current_time",
                "description": "查詢目前時間，支援指定時區（例如 Asia/Taipei）。",
                "parameters": {
                    "type": "object",
                    "properties": {"timezone": {"type": "string", "description": "IANA 時區，例如 Asia/Taipei。"}},
                    "required": [],
                },
            },
        }
    ]
    if flags.get("weather", True):
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "查詢某地區目前天氣。若未提供地點，可依使用者位置補全。",
                    "parameters": {
                        "type": "object",
                        "properties": {"location": {"type": "string", "description": "城市或地區名稱。"}},
                        "required": [],
                    },
                },
            }
        )
    if flags.get("youtube", True):
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": "search_youtube_videos",
                    "description": "搜尋旅遊相關 YouTube 影片推薦。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "主題關鍵字。"},
                            "location": {"type": "string", "description": "地區名稱。"},
                            "max_results": {"type": "integer", "description": "回傳筆數，1-10。"},
                        },
                        "required": ["query"],
                    },
                },
            }
        )
    if flags.get("travel_info", True):
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": "search_travel_information",
                    "description": "搜尋旅遊景點、活動、當地資訊。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "自然語言查詢內容。"},
                            "region": {"type": "string", "description": "地區名稱。"},
                            "max_results": {"type": "integer", "description": "回傳筆數，1-8。"},
                        },
                        "required": ["query"],
                    },
                },
            }
        )
    if flags.get("transport", True):
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": "search_transport_options",
                    "description": "搜尋兩地之間交通方式、路線與票價資訊。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "departure": {"type": "string", "description": "出發地。"},
                            "destination": {"type": "string", "description": "目的地。"},
                            "budget": {"type": "number", "description": "預算。"},
                        },
                        "required": ["departure", "destination"],
                    },
                },
            }
        )
    return schemas


def extract_tool_calls(message: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_calls = message.get("tool_calls")
    if not isinstance(raw_calls, list):
        return []
    calls: List[Dict[str, Any]] = []
    for item in raw_calls:
        if not isinstance(item, dict):
            continue
        function_obj = item.get("function") if isinstance(item.get("function"), dict) else {}
        name = function_obj.get("name") or item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        arguments = parse_tool_arguments(function_obj.get("arguments", item.get("arguments")))
        calls.append({"name": name.strip(), "arguments": arguments})
    return calls


async def _tool_get_current_time(args: Dict[str, Any], context: Dict[str, Any]) -> ToolResult:
    return await get_current_time(str(args.get("timezone") or ""), context["default_timezone"])


async def _tool_get_weather(args: Dict[str, Any], context: Dict[str, Any]) -> ToolResult:
    query = str(args.get("query") or context.get("last_user_message") or "")
    region_data = await infer_weather_region(
        explicit_region=_extract_weather_location(args),
        query=query,
        user_ai_settings=context.get("user_ai_settings", {}),
        default_region=context.get("default_region"),
        user_agent=context["http_user_agent"],
    )
    return await get_weather(
        region=region_data["region"],
        user_agent=context["http_user_agent"],
        query=query,
        location_source=region_data["location_source"],
    )


async def _tool_search_youtube(args: Dict[str, Any], context: Dict[str, Any]) -> ToolResult:
    query = str(args.get("query") or context.get("last_user_message") or "")
    location = str(args.get("location") or context.get("default_region") or "")
    max_results = int(args.get("max_results") or 5)
    return await search_youtube_videos(query, location, max_results, context.get("youtube_api_key", ""))


async def _tool_search_travel_info(args: Dict[str, Any], context: Dict[str, Any]) -> ToolResult:
    query = str(args.get("query") or context.get("last_user_message") or "")
    region = str(args.get("region") or context.get("default_region") or "")
    limit = int(args.get("max_results") or 5)
    return await search_travel_information(query=query, region=region, limit=limit)


async def _tool_search_transport(args: Dict[str, Any], _context: Dict[str, Any]) -> ToolResult:
    departure = str(args.get("departure") or "")
    destination = str(args.get("destination") or "")
    budget = args.get("budget")
    return await search_transport_options(departure=departure, destination=destination, budget=budget, limit=5)


def build_tool_executor() -> Dict[str, ToolHandler]:
    return {
        "get_current_time": _tool_get_current_time,
        "get_weather": _tool_get_weather,
        "search_youtube_videos": _tool_search_youtube,
        "search_travel_information": _tool_search_travel_info,
        "search_transport_options": _tool_search_transport,
    }


def should_force_weather_tool(last_user_message: str) -> bool:
    return is_weather_query(last_user_message)


async def resolve_tool_context(
    client: httpx.AsyncClient,
    ollama_base_url: str,
    model: str,
    base_messages: List[Dict[str, Any]],
    context: Dict[str, Any],
    tool_flags: Dict[str, bool],
    max_rounds: int = 3,
    max_calls_per_round: int = 4,
) -> Dict[str, Any]:
    tool_policy = context.get("tool_policy_json") if isinstance(context, dict) else {}
    if isinstance(tool_policy, dict) and tool_policy.get("enabled") is False:
        return {
            "messages": base_messages,
            "used_tools": False,
            "direct_reply": "",
            "tool_calls_summary": [],
            "youtube_tool_videos": [],
        }

    tools = get_tool_schemas(tool_flags)
    tool_executor = build_tool_executor()
    working_messages = list(base_messages)
    used_tools = False
    direct_reply = ""
    tool_calls_summary: List[Dict[str, Any]] = []
    forced_weather_once = False
    weather_result_cache: Optional[Dict[str, Any]] = None
    weather_summary_added = False
    youtube_tool_videos: List[Dict[str, Any]] = []

    for _ in range(max(1, max_rounds)):
        planner_response = await client.post(
            f"{ollama_base_url}/api/chat",
            json={
                "model": model,
                "stream": False,
                "messages": working_messages,
                "tools": tools,
                "options": {"temperature": 0.2, "num_predict": 800},
            },
        )
        if planner_response.status_code >= 400:
            return {
                "messages": base_messages,
                "used_tools": False,
                "direct_reply": "",
                "tool_calls_summary": tool_calls_summary,
                "youtube_tool_videos": [],
            }
        planner_data = planner_response.json()
        assistant_message = (planner_data.get("message") or {}) if isinstance(planner_data, dict) else {}
        tool_calls = extract_tool_calls(assistant_message)
        if not tool_calls:
            should_force_weather = (
                (not forced_weather_once)
                and bool(tool_flags.get("weather", True))
                and should_force_weather_tool(str(context.get("last_user_message") or ""))
            )
            if should_force_weather:
                forced_weather_once = True
                handler = tool_executor.get("get_weather")
                if handler is not None:
                    try:
                        forced_result = await handler({}, context)
                    except Exception as error:
                        forced_result = make_tool_result(
                            ok=False,
                            source="get_weather",
                            error=f"{type(error).__name__}: {error}",
                        )
                    weather_result_cache = forced_result
                    weather_summary_added = True
                    used_tools = True
                    forced_summary = {
                        "tool": "get_weather",
                        "ok": bool(forced_result.get("ok")),
                        "source": forced_result.get("source"),
                        "error": forced_result.get("error"),
                        "arguments": {},
                    }
                    tool_calls_summary.append(forced_summary)
                    working_messages.append(
                        {
                            "role": "system",
                            "content": (
                                "以下是工具查詢結果（JSON）。請整合後回覆使用者，並標註可能會隨時間變動的資訊：\n"
                                + json.dumps(
                                    [{"tool": "get_weather", "arguments": {}, "result": forced_result}],
                                    ensure_ascii=False,
                                )
                            ),
                        }
                    )
                    continue
            direct_reply = (assistant_message.get("content") or "").strip()
            return {
                "messages": working_messages,
                "used_tools": used_tools,
                "direct_reply": direct_reply,
                "tool_calls_summary": tool_calls_summary,
                "youtube_tool_videos": youtube_tool_videos,
            }

        used_tools = True
        tool_results: List[Dict[str, Any]] = []
        for tool_call in tool_calls[: max(1, max_calls_per_round)]:
            name = tool_call["name"]
            args = dict(tool_call["arguments"])
            if name == "get_weather" and weather_result_cache is not None:
                result = weather_result_cache
                if not weather_summary_added:
                    weather_summary_added = True
                    tool_calls_summary.append(
                        {
                            "tool": name,
                            "ok": bool(result.get("ok")),
                            "source": result.get("source"),
                            "error": result.get("error"),
                            "arguments": args,
                        }
                    )
            else:
                handler = tool_executor.get(name)
                if handler is None:
                    result = make_tool_result(ok=False, source="tool-executor", error=f"unsupported tool: {name}")
                else:
                    result = await _execute_with_retry(handler, args, context, name, max_retries=2)
                if name == "get_weather":
                    weather_result_cache = result
                    weather_summary_added = True
                if name == "search_youtube_videos" and result.get("ok"):
                    data = result.get("data") or {}
                    for v in (data.get("videos") or [])[:10]:
                        if isinstance(v, dict) and v.get("video_id"):
                            youtube_tool_videos.append({
                                "video_id": 0,
                                "youtube_id": str(v.get("video_id", "")),
                                "title": str(v.get("title", "")),
                                "channel": str(v.get("channel", "")),
                                "segments": [],
                                "thumbnail_url": f"https://i.ytimg.com/vi/{v.get('video_id', '')}/mqdefault.jpg",
                                "summary": str(v.get("description", "")),
                            })
                tool_calls_summary.append(
                    {
                        "tool": name,
                        "ok": bool(result.get("ok")),
                        "source": result.get("source"),
                        "error": result.get("error"),
                        "arguments": args,
                    }
                )
            tool_results.append({"tool": name, "arguments": args, "result": result})

        working_messages.append(
            {
                "role": "system",
                "content": (
                    "以下是工具查詢結果（JSON）。請整合後回覆使用者，並標註可能會隨時間變動的資訊：\n"
                    + json.dumps(tool_results, ensure_ascii=False)
                ),
            }
        )

    return {
        "messages": working_messages,
        "used_tools": used_tools,
        "direct_reply": direct_reply,
        "tool_calls_summary": tool_calls_summary,
        "youtube_tool_videos": youtube_tool_videos,
    }
