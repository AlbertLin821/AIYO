# AIYO 愛遊 - 字幕取得模組
# 使用 youtube-transcript-api（無 OAuth、無配額），無字幕時回傳 None 由呼叫端改用 Whisper

from typing import Optional

from youtube_transcript_api import YouTubeTranscriptApi


def fetch_transcript(youtube_id: str, lang_prefer: Optional[list[str]] = None) -> Optional[list[tuple[float, float, str]]]:
    """
    使用 youtube-transcript-api 取得字幕。
    回傳 [(start_sec, end_sec, text), ...]，若無法取得則回傳 None（需改用 Whisper）。

    lang_prefer: 優先語言代碼，如 ["zh-TW", "zh-Hant", "zh", "en"]
    """
    if lang_prefer is None:
        lang_prefer = ["zh-TW", "zh-Hant", "zh", "en"]

    try:
        fetched = YouTubeTranscriptApi().fetch(youtube_id, languages=lang_prefer)
    except Exception:
        return None

    if not fetched:
        return None

    raw = fetched.to_raw_data()
    result = []
    for item in raw:
        start = item.get("start", 0.0)
        duration = item.get("duration", 0.0)
        end = start + duration
        text = (item.get("text") or "").strip()
        if text:
            result.append((start, end, text))
    return result if result else None


def merge_adjacent_cues(
    cues: list[tuple[float, float, str]],
    max_gap_sec: float = 2.0,
    max_length_chars: int = 80,
) -> list[tuple[float, float, str]]:
    """
    合併相鄰字幕，減少片段數量。
    - 間隔小於 max_gap_sec 且合併後長度不超過 max_length_chars 則合併
    """
    if not cues:
        return []
    merged = []
    current_start, current_end, current_text = cues[0]
    for start, end, text in cues[1:]:
        gap = start - current_end
        combined = current_text + " " + text if current_text else text
        if gap <= max_gap_sec and len(combined) <= max_length_chars:
            current_end = end
            current_text = combined.strip()
        else:
            merged.append((current_start, current_end, current_text))
            current_start, current_end, current_text = start, end, text
    merged.append((current_start, current_end, current_text))
    return merged
