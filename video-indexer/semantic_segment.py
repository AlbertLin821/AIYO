# AIYO 愛遊 - Embedding 與語意分段模組
# paraphrase-multilingual-MiniLM-L12-v2，384 維
# cosine 相似度閾值 + 時間間隔規則

from typing import NamedTuple

import numpy as np
from sentence_transformers import SentenceTransformer


EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
BATCH_SIZE = 32  # 固定 batch_size，避免結果不一致
SIMILARITY_THRESHOLD = 0.65  # 低於此閾值可切段
MIN_SEGMENT_DURATION_SEC = 15  # 最短片段長度（秒）


class Segment(NamedTuple):
    start_sec: float
    end_sec: float
    texts: list[str]
    embedding: np.ndarray  # 384 維，segment 的代表向量（各句平均）


_model: SentenceTransformer | None = None


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


def encode_texts(texts: list[str], show_progress: bool = True) -> np.ndarray:
    """對文字列表產生 embedding，固定 batch_size=32。"""
    model = get_embedding_model()
    return model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=show_progress)


def segment_by_semantic_similarity(
    cues: list[tuple[float, float, str]],
    similarity_threshold: float = SIMILARITY_THRESHOLD,
    min_duration_sec: float = MIN_SEGMENT_DURATION_SEC,
) -> list[Segment]:
    """
    語意分段：依 cosine 相似度與時間間隔切段。
    回傳 list[Segment]，每個 Segment 含起訖時間、文本列表、embedding 向量。
    """
    if not cues:
        return []

    texts = [t for _, _, t in cues]
    embeddings = encode_texts(texts)
    n = len(cues)

    # 計算相鄰句子相似度
    split_points = [0]  # 在 index 0 前切
    for i in range(n - 1):
        sim = float(np.dot(embeddings[i], embeddings[i + 1]) / (
            np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[i + 1]) + 1e-9
        ))
        start_i, end_i = cues[i][0], cues[i][1]
        start_next = cues[i + 1][0]
        gap = start_next - end_i
        if sim < similarity_threshold and gap > 2.0:
            split_points.append(i + 1)
    split_points.append(n)

    segments = []
    for j in range(len(split_points) - 1):
        lo, hi = split_points[j], split_points[j + 1]
        seg_cues = cues[lo:hi]
        seg_texts = [t for _, _, t in seg_cues]
        start_sec = seg_cues[0][0]
        end_sec = seg_cues[-1][1]
        if end_sec - start_sec < min_duration_sec and len(segments) > 0:
            prev = segments[-1]
            new_texts = list(prev.texts) + seg_texts
            seg_emb = np.mean(embeddings[lo:hi], axis=0).astype(np.float32)
            new_emb = np.mean([prev.embedding, seg_emb], axis=0).astype(np.float32)
            segments[-1] = Segment(
                start_sec=prev.start_sec,
                end_sec=end_sec,
                texts=new_texts,
                embedding=new_emb,
            )
        else:
            seg_embeddings = embeddings[lo:hi]
            seg_embedding = np.mean(seg_embeddings, axis=0).astype(np.float32)
            segments.append(Segment(
                start_sec=start_sec,
                end_sec=end_sec,
                texts=seg_texts,
                embedding=seg_embedding,
            ))

    return segments
