"""RAG 混合搜尋：Reciprocal Rank Fusion 單元測試。"""
from __future__ import annotations

import unittest

from app.main import reciprocal_rank_fusion


class TestReciprocalRankFusion(unittest.TestCase):
    def test_both_lists_merge_and_dedupe(self) -> None:
        dense = [{"id": 1, "summary": "a"}, {"id": 2, "summary": "b"}]
        sparse = [{"id": 2, "summary": "b2"}, {"id": 3, "summary": "c"}]
        out = reciprocal_rank_fusion(dense, sparse, k=60, final_limit=10)
        ids = [r["id"] for r in out]
        self.assertEqual(len(ids), 3)
        self.assertEqual(set(ids), {1, 2, 3})

    def test_dense_only(self) -> None:
        dense = [{"id": 10}, {"id": 11}]
        out = reciprocal_rank_fusion(dense, [], final_limit=1)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], 10)

    def test_sparse_only(self) -> None:
        sparse = [{"id": 5}, {"id": 6}]
        out = reciprocal_rank_fusion([], sparse, final_limit=2)
        self.assertEqual([r["id"] for r in out], [5, 6])

    def test_final_limit(self) -> None:
        dense = [{"id": i} for i in range(10)]
        sparse = [{"id": i} for i in range(10, 20)]
        out = reciprocal_rank_fusion(dense, sparse, final_limit=3)
        self.assertEqual(len(out), 3)


if __name__ == "__main__":
    unittest.main()
