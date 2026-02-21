# AIYO 愛遊 - Whisper 語音轉文字模組
# 無字幕時使用：yt-dlp 下載音訊 + openai-whisper 轉錄

import tempfile
from pathlib import Path
from typing import Optional

import whisper
import yt_dlp


def download_audio(youtube_id: str, out_path: Path) -> bool:
    """
    使用 yt-dlp 下載影片音訊為 mp3，儲存至 out_path。
    回傳是否成功。
    """
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
        "outtmpl": str(out_path.with_suffix("")),
        "quiet": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return out_path.with_suffix(".mp3").exists()
    except Exception:
        return False


def transcribe_audio(audio_path: Path, model_size: str = "base") -> list[tuple[float, float, str]]:
    """
    使用 openai-whisper 轉錄音訊。
    回傳 [(start_sec, end_sec, text), ...]
    """
    model = whisper.load_model(model_size)
    result = model.transcribe(str(audio_path), language="zh", verbose=False)
    cues = []
    for seg in result.get("segments", []):
        start = seg.get("start", 0.0)
        end = seg.get("end", start)
        text = (seg.get("text") or "").strip()
        if text:
            cues.append((start, end, text))
    return cues


def transcribe_video(youtube_id: str, model_size: str = "base") -> Optional[list[tuple[float, float, str]]]:
    """
    下載影片音訊並轉錄，回傳 [(start_sec, end_sec, text), ...]。
    失敗時回傳 None。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "audio"
        if not download_audio(youtube_id, out_path):
            return None
        audio_path = out_path.with_suffix(".mp3")
        if not audio_path.exists():
            return None
        return transcribe_audio(audio_path, model_size=model_size)
