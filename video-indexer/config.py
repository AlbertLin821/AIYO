# AIYO 愛遊 - 影片索引器設定
# 從專案根目錄載入 .env（不修改 .env 內容）

import os
from pathlib import Path

from dotenv import load_dotenv

# 專案根目錄（video-indexer 的上層）
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"

load_dotenv(ENV_PATH)


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise ValueError(
            "DATABASE_URL 未設定，請在專案根目錄 .env 中設定。"
        )
    return url


def get_youtube_api_key() -> str:
    key = os.getenv("YOUTUBE_API_KEY")
    if not key or key == "your_youtube_api_key_here":
        raise ValueError(
            "YOUTUBE_API_KEY 未設定，請在專案根目錄 .env 中設定。"
            "取得方式請參考 docs/API金鑰取得與配置指南.md"
        )
    return key


def get_ollama_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


def get_ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
