#!/usr/bin/env python3
# AIYO 愛遊 - YouTube 影片搜尋並寫入 videos 表
# 使用 YouTube Data API v3 search.list + videos.list

import argparse
import sys
from pathlib import Path

# 將 video-indexer 加入 path，以匯入 config
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import psycopg2
from config import get_database_url, get_youtube_api_key


# 預設搜尋關鍵字（台灣旅遊相關）
DEFAULT_QUERIES = [
    "台灣旅遊",
    "台南兩天一夜",
    "台中一日遊",
    "台北美食",
]

# search.list 每次 100 units，建議 maxResults=50 以節省配額
MAX_RESULTS_PER_QUERY = 50


def create_youtube_client(api_key: str):
    """建立 YouTube API 用戶端。"""
    return build("youtube", "v3", developerKey=api_key)


def search_videos(youtube, query: str, max_results: int = MAX_RESULTS_PER_QUERY):
    """
    使用 search.list 搜尋影片，回傳 video ID 列表。
    """
    try:
        response = (
            youtube.search()
            .list(
                part="id,snippet",
                q=query,
                type="video",
                maxResults=min(max_results, 50),  # API 上限 50
                order="relevance",
                relevanceLanguage="zh",
            )
            .execute()
        )
    except HttpError as e:
        raise RuntimeError(f"YouTube API 錯誤: {e}") from e

    video_ids = []
    for item in response.get("items", []):
        if item["id"]["kind"] == "youtube#video":
            video_ids.append(item["id"]["videoId"])
    return video_ids


def get_video_details(youtube, video_ids: list):
    """
    使用 videos.list 取得影片 metadata。
    回傳 list[dict]，每個 dict 含 youtube_id, title, channel, duration, view_count, like_count。
    """
    if not video_ids:
        return []

    # API 每次最多 50 個 ID
    batch_size = 50
    all_items = []

    for i in range(0, len(video_ids), batch_size):
        batch = video_ids[i : i + batch_size]
        try:
            response = (
                youtube.videos()
                .list(
                    part="snippet,contentDetails,statistics",
                    id=",".join(batch),
                )
                .execute()
            )
        except HttpError as e:
            raise RuntimeError(f"YouTube API 錯誤: {e}") from e

        all_items.extend(response.get("items", []))

    results = []
    for item in all_items:
        vid = item["id"]
        snip = item.get("snippet", {})
        details = item.get("contentDetails", {})
        stats = item.get("statistics", {})

        # duration 格式：PT1H2M10S -> 秒數
        duration_raw = details.get("duration", "PT0S")
        duration_sec = parse_iso8601_duration(duration_raw)

        results.append({
            "youtube_id": vid,
            "title": snip.get("title", ""),
            "channel": snip.get("channelTitle"),
            "duration": duration_sec,
            "view_count": int(stats.get("viewCount", 0) or 0),
            "like_count": int(stats.get("likeCount", 0) or 0),
        })
    return results


def parse_iso8601_duration(duration: str) -> int:
    """PT1H2M10S -> 3730 秒。"""
    import re
    if not duration or duration == "PT0S":
        return 0
    total = 0
    for m in re.finditer(r"(\d+)([HMS])", duration):
        val, unit = int(m.group(1)), m.group(2)
        if unit == "H":
            total += val * 3600
        elif unit == "M":
            total += val * 60
        elif unit == "S":
            total += val
    return total


def upsert_videos(conn, videos: list) -> tuple[int, int]:
    """
    將影片寫入 videos 表，若 youtube_id 已存在則略過。
    回傳 (新增數, 略過數)。
    """
    if not videos:
        return 0, 0

    inserted = 0
    skipped = 0

    with conn.cursor() as cur:
        for v in videos:
            try:
                cur.execute(
                    """
                    INSERT INTO videos (youtube_id, title, channel, duration, view_count, like_count)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (youtube_id) DO NOTHING
                    """,
                    (
                        v["youtube_id"],
                        v["title"],
                        v["channel"],
                        v["duration"],
                        v["view_count"],
                        v["like_count"],
                    ),
                )
                if cur.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"  寫入失敗 {v['youtube_id']}: {e}")
                conn.rollback()
                raise
        conn.commit()

    return inserted, skipped


def main():
    parser = argparse.ArgumentParser(
        description="YouTube 影片搜尋並寫入 videos 表"
    )
    parser.add_argument(
        "queries",
        nargs="*",
        default=DEFAULT_QUERIES,
        help="搜尋關鍵字，預設: " + ", ".join(DEFAULT_QUERIES),
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=MAX_RESULTS_PER_QUERY,
        help=f"每個關鍵字最多取得影片數 (預設 {MAX_RESULTS_PER_QUERY})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="僅搜尋不寫入資料庫",
    )
    args = parser.parse_args()

    try:
        api_key = get_youtube_api_key()
    except ValueError as e:
        print(f"設定錯誤: {e}")
        sys.exit(1)

    try:
        db_url = get_database_url()
    except ValueError as e:
        print(f"設定錯誤: {e}")
        sys.exit(1)

    youtube = create_youtube_client(api_key)
    all_video_ids = []
    seen = set()

    for q in args.queries:
        print(f"搜尋: {q}")
        ids = search_videos(youtube, q, max_results=args.max_results)
        new_ids = [i for i in ids if i not in seen]
        seen.update(new_ids)
        all_video_ids.extend(new_ids)
        print(f"  取得 {len(new_ids)} 支新影片 (共 {len(seen)} 支)")

    if not all_video_ids:
        print("無新影片可處理。")
        return

    print(f"\n取得 {len(all_video_ids)} 支影片的詳細資訊...")
    videos = get_video_details(youtube, all_video_ids)
    print(f"共 {len(videos)} 支影片。")

    if args.dry_run:
        for v in videos[:5]:
            print(f"  {v['youtube_id']}: {v['title'][:50]}...")
        if len(videos) > 5:
            print(f"  ... 其餘 {len(videos) - 5} 支")
        print("\n(--dry-run 未寫入資料庫)")
        return

    conn = psycopg2.connect(db_url)
    try:
        inserted, skipped = upsert_videos(conn, videos)
        print(f"\n寫入完成: 新增 {inserted} 支，略過重複 {skipped} 支。")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
