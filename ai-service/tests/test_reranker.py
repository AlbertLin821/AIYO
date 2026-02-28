from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.reranker import (
    RecommendationCandidate,
    rerank_candidates,
    scored_to_response,
    build_candidates_from_db_rows,
    build_candidates_from_youtube_api,
)


class RerankCandidatesTests(unittest.TestCase):
    def test_city_match_boosts_score(self) -> None:
        candidates = [
            RecommendationCandidate(source="db_rag", title="台南夜市攻略", city="台南"),
            RecommendationCandidate(source="db_rag", title="高雄美術館", city="高雄"),
        ]
        results = rerank_candidates(
            candidates=candidates,
            keywords=[],
            preferred_cities={"台南"},
            budget_pref="",
            pace_pref="",
            constraints=[],
            limit=5,
        )
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].candidate.city, "台南")
        self.assertGreater(results[0].final_score, results[1].final_score)

    def test_keyword_match_boosts_score(self) -> None:
        candidates = [
            RecommendationCandidate(source="db_rag", title="台北溫泉之旅", summary="北投溫泉"),
            RecommendationCandidate(source="db_rag", title="台北購物指南", summary="信義區百貨"),
        ]
        results = rerank_candidates(
            candidates=candidates,
            keywords=["溫泉"],
            preferred_cities=set(),
            budget_pref="",
            pace_pref="",
            constraints=[],
            limit=5,
        )
        self.assertEqual(results[0].candidate.title, "台北溫泉之旅")
        self.assertTrue(any("溫泉" in r for r in results[0].reasons))

    def test_constraint_penalty(self) -> None:
        candidates = [
            RecommendationCandidate(source="db_rag", title="人潮最多的夜市", summary="超級人潮"),
            RecommendationCandidate(source="db_rag", title="安靜的寺廟", summary="清幽古寺"),
        ]
        results = rerank_candidates(
            candidates=candidates,
            keywords=[],
            preferred_cities=set(),
            budget_pref="",
            pace_pref="",
            constraints=["人潮"],
            limit=5,
        )
        self.assertEqual(results[0].candidate.title, "安靜的寺廟")

    def test_recommendation_reasons_present(self) -> None:
        candidates = [
            RecommendationCandidate(source="db_rag", title="平價小吃之旅", city="台南"),
        ]
        results = rerank_candidates(
            candidates=candidates,
            keywords=["小吃"],
            preferred_cities={"台南"},
            budget_pref="低",
            pace_pref="",
            constraints=[],
        )
        self.assertTrue(len(results) > 0)
        self.assertTrue(len(results[0].reasons) > 0)

    def test_behavior_feedback_boosts_interacted_video(self) -> None:
        candidates = [
            RecommendationCandidate(source="db_rag", youtube_id="yt_hot", title="一般景點推薦"),
            RecommendationCandidate(source="db_rag", youtube_id="yt_cold", title="一般景點推薦"),
        ]
        results = rerank_candidates(
            candidates=candidates,
            keywords=[],
            preferred_cities=set(),
            budget_pref="",
            pace_pref="",
            constraints=[],
            interaction_scores={"yt_hot": 3.0, "yt_cold": -2.0},
            limit=5,
        )
        self.assertEqual(results[0].candidate.youtube_id, "yt_hot")
        self.assertGreater(results[0].final_score, results[1].final_score)
        self.assertIn("behavior_feedback", results[0].score_breakdown)

    def test_scored_to_response_format(self) -> None:
        candidates = [
            RecommendationCandidate(
                source="db_rag", video_id=1, youtube_id="abc123",
                title="Test", city="台北", segments=[{"segment_id": 1, "start_sec": 10, "end_sec": 60}],
            ),
        ]
        results = rerank_candidates(candidates, [], set(), "", "", [])
        response = scored_to_response(results)
        self.assertEqual(len(response), 1)
        self.assertIn("recommendation_reasons", response[0])
        self.assertIn("score_breakdown", response[0])
        self.assertIn("rank_position", response[0])
        self.assertEqual(response[0]["rank_position"], 1)


class BuildCandidatesTests(unittest.TestCase):
    def test_from_db_rows(self) -> None:
        rows = [
            {
                "segment_id": 1, "video_id": 10, "start_sec": 0, "end_sec": 60,
                "summary": "台北101觀景台", "tags": {"place": "101"}, "city": "台北",
                "created_at": datetime.now(timezone.utc),
                "youtube_id": "vid1", "title": "台北之旅", "channel": "Travel", "duration": 600,
            },
            {
                "segment_id": 2, "video_id": 10, "start_sec": 61, "end_sec": 120,
                "summary": "西門町逛街", "tags": {}, "city": "台北",
                "created_at": datetime.now(timezone.utc),
                "youtube_id": "vid1", "title": "台北之旅", "channel": "Travel", "duration": 600,
            },
        ]
        candidates = build_candidates_from_db_rows(rows)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(len(candidates[0].segments), 2)

    def test_from_youtube_api(self) -> None:
        items = [
            {"video_id": "yt1", "title": "Cool Video", "channel": "CH1", "description": "desc"},
            {"video_id": "yt2", "title": "Nice Trip", "channel": "CH2", "description": "desc2"},
        ]
        candidates = build_candidates_from_youtube_api(items)
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0].source, "youtube_api")


if __name__ == "__main__":
    unittest.main()
