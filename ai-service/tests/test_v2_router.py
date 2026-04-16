from __future__ import annotations

from datetime import datetime, timezone
import unittest

from fastapi import HTTPException

from app.v2_router import (
    _ensure_embedding_contract,
    _plan_result_to_contract,
    normalize_contract_item,
    parse_voice_intent_text,
)


class ParseVoiceIntentTests(unittest.TestCase):
    def test_parse_basic_intent(self) -> None:
        text = "\u6211\u60f3\u53bb\u6771\u4eac 4 \u5929\uff0c\u9810\u7b97 30000\uff0c\u559c\u6b61\u591c\u666f\u548c\u535a\u7269\u9928"
        parsed = parse_voice_intent_text(text)
        self.assertEqual(parsed["destination"], "\u6771\u4eac")
        self.assertEqual(parsed["days"], 4)
        self.assertIn("\u591c\u666f", parsed["preferences"])


class NormalizeContractItemTests(unittest.TestCase):
    def test_normalize_required_fields(self) -> None:
        row = {
            "internal_place_id": "11111111-1111-1111-1111-111111111111",
            "google_place_id": "g-123",
            "segment_id": "22222222-2222-2222-2222-222222222222",
            "lat": 25.0,
            "lng": 121.0,
            "start_sec": 30,
            "end_sec": 90,
            "summary": "\u591c\u666f\u6563\u6b65",
            "segment_city": "\u6771\u4eac",
            "video_city": "\u6771\u4eac",
            "place_name": "\u6f80\u8c37",
            "video_title": "\u6771\u4eac\u591c\u666f",
            "stats_updated_at": datetime.now(timezone.utc),
            "geocode_status": "ok",
            "embedding_ok": True,
            "view_count": 100,
            "like_count": 10,
        }
        item = normalize_contract_item(row, query="\u591c\u666f", destination="\u6771\u4eac")
        self.assertEqual(item["internalPlaceId"], row["internal_place_id"])
        self.assertEqual(item["segmentId"], row["segment_id"])
        self.assertEqual(item["startSec"], 30)
        self.assertFalse(item["statsStale"])
        self.assertIn("query_match", item["reason"])
        self.assertIn("destination_match", item["reason"])

    def test_pending_geocode_retry_exhausted_reason(self) -> None:
        row = {
            "internal_place_id": "11111111-1111-1111-1111-111111111111",
            "google_place_id": None,
            "segment_id": "22222222-2222-2222-2222-222222222222",
            "lat": None,
            "lng": None,
            "start_sec": 10,
            "end_sec": 20,
            "summary": "",
            "segment_city": "",
            "video_city": "",
            "place_name": "Unknown",
            "video_title": "Video",
            "stats_updated_at": None,
            "geocode_status": "pending",
            "geocode_retry_count": 3,
            "embedding_ok": False,
            "view_count": 0,
            "like_count": 0,
        }
        item = normalize_contract_item(row, query="", destination=None)
        self.assertEqual(item["geocodeStatus"], "pending")
        self.assertEqual(item["geocodeRetryCount"], 3)
        self.assertIn("marker_hidden_geocode_retry_exhausted", item["reason"])


class PlanContractTests(unittest.TestCase):
    def test_failed_segment_goes_to_unmapped(self) -> None:
        recommendations = [
            {
                "internalPlaceId": "11111111-1111-1111-1111-111111111111",
                "googlePlaceId": "g-1",
                "segmentId": "22222222-2222-2222-2222-222222222222",
                "lat": None,
                "lng": None,
                "startSec": 30,
                "endSec": 90,
                "reason": ["marker_hidden_geocode_failed"],
                "statsUpdatedAt": None,
                "statsStale": True,
                "geocodeStatus": "failed",
                "placeName": "Foo",
            }
        ]
        planner_response = {"feasible": False, "warnings": [], "days": []}
        contract = _plan_result_to_contract(planner_response, recommendations)
        self.assertEqual(len(contract["unmappedSegments"]), 1)
        self.assertTrue(contract["unmappedSegments"][0]["manualConfirmationRequired"])


class EmbeddingContractTests(unittest.TestCase):
    def test_embedding_dim_mismatch_raises_422(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _ensure_embedding_contract("nomic-embed-text", "1", 1024)
        self.assertEqual(ctx.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
