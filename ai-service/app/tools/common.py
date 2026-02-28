from __future__ import annotations

import json
from typing import Any, Dict, Optional


ToolResult = Dict[str, Any]


def make_tool_result(ok: bool, source: str, data: Any = None, error: Optional[str] = None) -> ToolResult:
    return {
        "ok": ok,
        "source": source,
        "data": data,
        "error": error,
    }


def parse_tool_arguments(raw_arguments: Any) -> Dict[str, Any]:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if isinstance(raw_arguments, str):
        text = raw_arguments.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}
