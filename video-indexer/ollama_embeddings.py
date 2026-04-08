from __future__ import annotations

import re
from typing import Iterable

import httpx

from config import get_ollama_base_url, get_ollama_embed_model


def _normalize_texts(texts: Iterable[str]) -> list[str]:
    return [text.strip() for text in texts if text and text.strip()]


def _request_embed(texts: list[str], model: str) -> list[list[float]] | None:
    base_url = get_ollama_base_url()
    timeout = httpx.Timeout(60.0, connect=5.0)

    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{base_url}/api/embed",
            json={"model": model, "input": texts if len(texts) > 1 else texts[0]},
        )
        if response.status_code < 400:
            data = response.json()
            embeddings = data.get("embeddings")
            if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
                return embeddings
            if isinstance(embeddings, list) and len(texts) == 1 and all(isinstance(item, (int, float)) for item in embeddings):
                return [embeddings]

        if len(texts) == 1:
            legacy = client.post(
                f"{base_url}/api/embeddings",
                json={"model": model, "prompt": texts[0]},
            )
            if legacy.status_code < 400:
                data = legacy.json()
                embedding = data.get("embedding")
                if isinstance(embedding, list) and all(isinstance(item, (int, float)) for item in embedding):
                    return [embedding]

    return None


def embed_text(text: str, model: str | None = None) -> list[float] | None:
    normalized = _normalize_texts([text])
    if not normalized:
        return None
    embeddings = _request_embed(normalized, model or get_ollama_embed_model())
    if not embeddings:
        return None
    return embeddings[0]


def embed_texts(texts: Iterable[str], model: str | None = None) -> list[list[float]]:
    normalized = _normalize_texts(texts)
    if not normalized:
        return []
    embeddings = _request_embed(normalized, model or get_ollama_embed_model())
    if embeddings and len(embeddings) == len(normalized):
        return embeddings
    return [embedding for text in normalized if (embedding := embed_text(text, model=model)) is not None]


def get_vector_column_dim(conn, table_name: str, column_name: str) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = %s::regclass
              AND a.attname = %s
              AND a.attnum > 0
              AND NOT a.attisdropped
            """,
            (table_name, column_name),
        )
        row = cur.fetchone()

    if not row or not row[0]:
        return None

    match = re.search(r"vector\((\d+)\)", row[0])
    if not match:
        return None
    return int(match.group(1))
