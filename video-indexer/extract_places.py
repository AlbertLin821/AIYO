# AIYO 愛遊 - 景點實體抽取模組
# 使用 Ollama LLM 從片段文本抽取景點與類型（JSON 格式）

import json
import re
from typing import Any

import httpx

from config import get_ollama_base_url, get_ollama_model


PLACE_CATEGORIES = ["美食", "親子", "室內", "室外", "文青", "夜景", "自然", "古蹟", "住宿", "購物", "其他"]

EXTRACT_PROMPT = """請從以下旅遊影片片段文字中抽取「景點或地點名稱」與「類型」。
只回傳 JSON 陣列，不要其他說明。格式如下：
[{"name": "景點名稱", "type": "類型"}, ...]

類型請從以下選一個：美食、親子、室內、室外、文青、夜景、自然、古蹟、住宿、購物、其他。
若無法判斷則用「其他」。
若沒有景點則回傳空陣列 []。

片段文字：
"""
END_MARKER = "\n```"


def extract_places_with_ollama(text: str, timeout: float = 30.0) -> list[dict[str, Any]]:
    """
    呼叫 Ollama 從文本抽取景點。
    回傳 [{"name": str, "type": str}, ...]
    """
    base_url = get_ollama_base_url().rstrip("/")
    model = get_ollama_model()
    prompt = EXTRACT_PROMPT + text.strip()[:2000]

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{base_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                },
            )
        resp.raise_for_status()
        data = resp.json()
        content = (data.get("response") or "").strip()
    except Exception:
        return []

    # 解析 JSON
    places = _parse_json_array(content)
    return _deduplicate_places(places)


def _parse_json_array(content: str) -> list[dict]:
    """從 LLM 輸出解析 JSON 陣列。"""
    content = content.strip()
    # 移除 markdown 程式碼區塊
    if "```" in content:
        match = re.search(r"\[[\s\S]*?\]", content)
        if match:
            content = match.group(0)
    try:
        arr = json.loads(content)
        if isinstance(arr, list):
            return [p for p in arr if isinstance(p, dict) and p.get("name")]
        return []
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*?\]", content)
        if match:
            try:
                arr = json.loads(match.group(0))
                return [p for p in arr if isinstance(p, dict) and p.get("name")]
            except json.JSONDecodeError:
                pass
        return []


def _deduplicate_places(places: list[dict]) -> list[dict]:
    """依 name 去重，保留首次出現的 type。"""
    seen = set()
    result = []
    for p in places:
        name = (p.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        ptype = (p.get("type") or "其他").strip()
        if ptype not in PLACE_CATEGORIES:
            ptype = "其他"
        result.append({"name": name, "type": ptype})
    return result


def summarize_segment_text(texts: list[str], max_chars: int = 150) -> str:
    """將片段文本合併為簡短摘要，供儲存或顯示。"""
    full = " ".join(texts).strip()
    full = re.sub(r"\s+", " ", full)
    if len(full) <= max_chars:
        return full
    return full[: max_chars - 3] + "..."
