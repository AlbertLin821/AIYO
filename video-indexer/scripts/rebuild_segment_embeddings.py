#!/usr/bin/env python3

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2
from psycopg2.extras import RealDictCursor, execute_batch

from config import get_database_url, get_ollama_embed_model
from ollama_embeddings import embed_texts, get_vector_column_dim


def load_segments(conn, ids: list[int] | None, limit: int | None):
    query = """
        SELECT id, summary
        FROM segments
        WHERE summary IS NOT NULL
          AND btrim(summary) <> ''
    """
    params: list[object] = []

    if ids:
        query += " AND id = ANY(%s)"
        params.append(ids)

    query += " ORDER BY id"
    if limit is not None:
        query += " LIMIT %s"
        params.append(limit)

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, tuple(params))
        return cur.fetchall()


def main():
    parser = argparse.ArgumentParser(description="重建 segments.embedding_vector")
    parser.add_argument("--ids", nargs="+", type=int, help="指定 segment id 列表")
    parser.add_argument("--limit", type=int, help="最多重建幾筆")
    parser.add_argument("--batch-size", type=int, default=16, help="每批送到 Ollama 的筆數")
    parser.add_argument("--dry-run", action="store_true", help="只檢查，不寫回資料庫")
    args = parser.parse_args()

    conn = psycopg2.connect(get_database_url())
    try:
        expected_dim = get_vector_column_dim(conn, "segments", "embedding_vector")
        if not expected_dim:
            raise RuntimeError("找不到 segments.embedding_vector 維度設定")

        rows = load_segments(conn, args.ids, args.limit)
        if not rows:
            print("沒有可重建的 segments。")
            return

        print(
            f"準備重建 {len(rows)} 筆 segments embeddings，"
            f"model={get_ollama_embed_model()} expected_dim={expected_dim}"
        )

        updates: list[tuple[str, int]] = []
        batch_size = max(1, args.batch_size)
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            summaries = [row["summary"] for row in batch]
            embeddings = embed_texts(summaries)
            if len(embeddings) != len(batch):
                raise RuntimeError(
                    f"Ollama embeddings 回傳數量不符: expected={len(batch)} got={len(embeddings)}"
                )

            for row, embedding in zip(batch, embeddings):
                if len(embedding) != expected_dim:
                    raise RuntimeError(
                        f"segment {row['id']} 維度不符: expected={expected_dim}, got={len(embedding)}"
                    )
                vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"
                updates.append((vector_literal, row["id"]))

            print(f"已處理 {min(start + len(batch), len(rows))}/{len(rows)}")

        if args.dry_run:
            print("dry-run 完成，未寫入資料庫。")
            return

        with conn.cursor() as cur:
            execute_batch(
                cur,
                """
                UPDATE segments
                SET embedding_vector = %s::vector
                WHERE id = %s
                """,
                updates,
                page_size=100,
            )
        conn.commit()
        print(f"完成寫回 {len(updates)} 筆 segments embeddings。")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
