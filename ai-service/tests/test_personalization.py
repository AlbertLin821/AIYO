from __future__ import annotations

import unittest

from app.personalization import (
    UserFeatures,
    merge_user_features,
    features_to_keywords,
    features_to_scoring_context,
    features_to_system_context,
)


class MergeUserFeaturesTests(unittest.TestCase):
    def test_merge_all_sources(self) -> None:
        profile = {
            "display_name": "Alice",
            "travel_style": "文青",
            "budget_pref": "中",
            "pace_pref": "慢",
            "transport_pref": "大眾運輸",
            "dietary_pref": "素食",
            "preferred_cities": ["台北", "台南"],
        }
        memories = [
            {"memory_type": "visited_city", "memory_text": "高雄", "confidence": 0.9},
            {"memory_type": "preference", "memory_text": "喜歡夜市和小吃", "confidence": 0.8},
        ]
        preferences_json = {
            "preferred_cities": ["花蓮"],
            "travel_likes": ["海邊", "溫泉"],
            "constraints": ["不喜歡人潮"],
        }
        ai_settings = {
            "current_region": "台中",
            "current_lat": 24.15,
            "current_lng": 120.67,
            "weather_default_region": "台北",
            "auto_use_current_location": True,
            "tool_policy_json": {"enabled": True},
        }

        features = merge_user_features(
            user_id=1,
            profile=profile,
            memories=memories,
            preferences_json=preferences_json,
            ai_settings=ai_settings,
        )

        self.assertEqual(features.display_name, "Alice")
        self.assertEqual(features.budget_pref, "中")
        self.assertIn("台北", features.preferred_cities)
        self.assertIn("高雄", features.preferred_cities)
        self.assertIn("花蓮", features.preferred_cities)
        self.assertIn("海邊", features.interests)
        self.assertIn("不喜歡人潮", features.constraints)
        self.assertEqual(features.current_region, "台中")
        self.assertTrue(features.tool_policy_enabled)

    def test_empty_sources(self) -> None:
        features = merge_user_features(
            user_id=2, profile=None, memories=[], preferences_json=None, ai_settings=None
        )
        self.assertEqual(features.user_id, 2)
        self.assertEqual(features.display_name, "")
        self.assertEqual(len(features.preferred_cities), 0)

    def test_features_to_keywords(self) -> None:
        features = UserFeatures(
            user_id=1,
            travel_style="美食 文青",
            interests=["夜市", "小吃"],
            memory_facts=["去過台南吃過擔仔麵"],
        )
        keywords = features_to_keywords(features)
        self.assertIn("美食", keywords)
        self.assertIn("夜市", keywords)
        self.assertTrue(len(keywords) <= 30)

    def test_features_to_system_context(self) -> None:
        features = UserFeatures(
            user_id=1,
            display_name="Bob",
            travel_style="背包客",
            preferred_cities={"台北", "台南"},
            current_region="高雄",
        )
        text = features_to_system_context(features)
        self.assertIn("Bob", text)
        self.assertIn("背包客", text)
        self.assertIn("高雄", text)


if __name__ == "__main__":
    unittest.main()
