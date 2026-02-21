#!/usr/bin/env python3
# AIYO 愛遊 - 影片索引主流程
# 取得字幕 -> (Whisper) -> 語意分段 -> 景點抽取 -> 寫入 DB

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
from psycopg2 import extras as pg_extras
from psycopg2.extras import RealDictCursor

from config import get_database_url
from transcripts import fetch_transcript, merge_adjacent_cues
from whisper_transcribe import transcribe_video
from semantic_segment import segment_by_semantic_similarity, Segment
from extract_places import extract_places_with_ollama, summarize_segment_text


def get_videos_to_index(conn, limit: int = 10, youtube_ids: list[str] | None = None):
    """取得尚未索引的影片（videos 表中沒有對應 segments 的）。"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if youtube_ids:
            placeholders = ",".join(["%s"] * len(youtube_ids))
            cur.execute(
                f"""
                SELECT v.id, v.youtube_id, v.title, v.channel
                FROM videos v
                LEFT JOIN segments s ON s.video_id = v.id
                WHERE v.youtube_id IN ({placeholders})
                GROUP BY v.id, v.youtube_id, v.title, v.channel
                HAVING COUNT(s.id) = 0
                """,
                youtube_ids,
            )
        else:
            cur.execute(
                """
                SELECT v.id, v.youtube_id, v.title, v.channel
                FROM videos v
                LEFT JOIN segments s ON s.video_id = v.id
                GROUP BY v.id, v.youtube_id, v.title, v.channel
                HAVING COUNT(s.id) = 0
                ORDER BY v.id
                LIMIT %s
                """,
                (limit,),
            )
        return cur.fetchall()


def get_transcript(youtube_id: str, use_whisper: bool = True, verbose: bool = True) -> list[tuple[float, float, str]] | None:
    """取得字幕，優先 transcript API，無則 Whisper。"""
    if verbose:
        print("    取得字幕...", flush=True)
    cues = fetch_transcript(youtube_id)
    if cues is not None:
        cues = merge_adjacent_cues(cues)
        if verbose:
            print(f"    字幕: {len(cues)} 則", flush=True)
        return cues
    if use_whisper:
        if verbose:
            print("    無字幕，使用 Whisper 轉錄（約 2-5 分鐘）...", flush=True)
        return transcribe_video(youtube_id, model_size="base")
    return None


def upsert_place(conn, name: str, category: str, city: str | None = None) -> int:
    """寫入或取得 place id。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO places (name, category, city)
            VALUES (%s, %s, %s)
            ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category
            RETURNING id
            """,
            (name, category, city),
        )
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute("SELECT id FROM places WHERE name = %s", (name,))
        return cur.fetchone()[0]


def index_video(conn, video: dict, use_whisper: bool = True, skip_places: bool = False, verbose: bool = True) -> tuple[int, int]:
    """
    索引單支影片。回傳 (segments 寫入數, 跳過原因 0=成功)。
    跳過原因：1=無字幕 2=無片段
    """
    video_id = video["id"]
    youtube_id = video["youtube_id"]
    title = video["title"]

    cues = get_transcript(youtube_id, use_whisper=use_whisper, verbose=verbose)
    if not cues:
        return 0, 1

    if verbose:
        print("    語意分段...", flush=True)
    segments = segment_by_semantic_similarity(cues)
    if verbose:
        print(f"    分段: {len(segments)} 個", flush=True)
    if not segments:
        return 0, 2

    seg_count = 0
    total = len(segments)
    with conn.cursor() as cur:
        for i, seg in enumerate(segments):
            if verbose and not skip_places:
                print(f"    景點抽取 ({i + 1}/{total})...", end=" ", flush=True)
            combined_text = " ".join(seg.texts)
            places_data = extract_places_with_ollama(combined_text) if not skip_places else []
            if verbose and not skip_places:
                print(f"完成", flush=True)
            summary = summarize_segment_text(seg.texts)

            tags = [{"name": p["name"], "type": p["type"]} for p in places_data]

            embedding_str = "[" + ",".join(str(x) for x in seg.embedding.tolist()) + "]"

            cur.execute(
                """
                INSERT INTO segments (video_id, start_sec, end_sec, summary, tags, embedding_vector)
                VALUES (%s, %s, %s, %s, %s, %s::vector)
                RETURNING id
                """,
                (
                    video_id,
                    int(seg.start_sec),
                    int(seg.end_sec),
                    summary,
                    pg_extras.Json(tags),
                    embedding_str,
                ),
            )
            seg_id = cur.fetchone()[0]
            seg_count += 1

            for p in places_data:
                cur.execute("SELECT id FROM places WHERE name = %s LIMIT 1", (p["name"],))
                row = cur.fetchone()
                if row:
                    place_id = row[0]
                else:
                    cur.execute(
                        "INSERT INTO places (name, category) VALUES (%s, %s) RETURNING id",
                        (p["name"], p["type"]),
                    )
                    place_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO segment_places (segment_id, place_id) VALUES (%s, %s) ON CONFLICT (segment_id, place_id) DO NOTHING",
                    (seg_id, place_id),
                )

        conn.commit()

    return seg_count, 0


def main():
    parser = argparse.ArgumentParser(description="影片索引：字幕、分段、景點、寫入 DB")
    parser.add_argument("--limit", type=int, default=5, help="最多處理幾支影片")
    parser.add_argument("--ids", nargs="+", help="指定 youtube_id 列表")
    parser.add_argument("--no-whisper", action="store_true", help="無字幕時不降級用 Whisper")
    parser.add_argument("--skip-places", action="store_true", help="略過 Ollama 景點抽取（加快速度，tags 為空）")
    args = parser.parse_args()

    conn = psycopg2.connect(get_database_url())
    try:
        videos = get_videos_to_index(conn, limit=args.limit, youtube_ids=args.ids)
        if not videos:
            print("無待索引影片。")
            return

        for v in videos:
            print(f"索引: {v['youtube_id']} - {v['title'][:40]}...")
            count, skip = index_video(conn, v, use_whisper=not args.no_whisper, skip_places=args.skip_places)
            if skip == 1:
                print("  跳過: 無字幕且未啟用 Whisper")
            elif skip == 2:
                print("  跳過: 無有效片段")
            else:
                print(f"  完成: {count} 個片段")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
