from __future__ import annotations

import unittest
from unittest.mock import patch

from app.planner import (
    PlannerConstraints,
    haversine_km,
    estimate_travel_minutes,
    plan_itinerary_v2,
    planner_result_to_response,
)


class HaversineTests(unittest.TestCase):
    def test_taipei_to_taichung(self) -> None:
        dist = haversine_km(25.0330, 121.5654, 24.1477, 120.6736)
        self.assertGreater(dist, 100)
        self.assertLess(dist, 200)

    def test_same_point(self) -> None:
        dist = haversine_km(25.0, 121.0, 25.0, 121.0)
        self.assertAlmostEqual(dist, 0.0, places=2)


class TravelEstimateTests(unittest.TestCase):
    def test_transit_estimate(self) -> None:
        minutes = estimate_travel_minutes(10.0, "transit")
        self.assertGreater(minutes, 20)

    def test_walk_estimate(self) -> None:
        minutes = estimate_travel_minutes(2.0, "walk")
        self.assertGreater(minutes, 20)


class PlanItineraryV2Tests(unittest.TestCase):
    def test_basic_plan(self) -> None:
        segments = [
            {"place_name": "台北101", "lat": 25.0339, "lng": 121.5645, "stay_minutes": 90, "estimated_cost": 200},
            {"place_name": "西門町", "lat": 25.0421, "lng": 121.5081, "stay_minutes": 120, "estimated_cost": 300},
            {"place_name": "士林夜市", "lat": 25.0876, "lng": 121.5244, "stay_minutes": 90, "estimated_cost": 150},
        ]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=1,
            constraints=PlannerConstraints(),
            preferences=[],
        )
        self.assertEqual(len(result.days), 1)
        self.assertEqual(len(result.days[0].slots), 3)
        self.assertTrue(result.days[0].slots[0].time_start)

    def test_budget_constraint(self) -> None:
        segments = [
            {"place_name": "高級餐廳", "stay_minutes": 60, "estimated_cost": 5000},
            {"place_name": "平價小吃", "stay_minutes": 60, "estimated_cost": 100},
        ]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=1,
            constraints=PlannerConstraints(budget_per_day=200),
            preferences=[],
        )
        placed_names = [s.place_name for s in result.days[0].slots]
        self.assertNotIn("高級餐廳", placed_names)
        self.assertIn("平價小吃", placed_names)

    def test_avoid_constraint(self) -> None:
        segments = [
            {"place_name": "夜市A"},
            {"place_name": "博物館B"},
        ]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=1,
            constraints=PlannerConstraints(avoid=["夜市"]),
            preferences=[],
        )
        placed_names = [s.place_name for s in result.days[0].slots]
        self.assertNotIn("夜市A", placed_names)
        self.assertIn("博物館B", placed_names)

    def test_must_visit_missing_warning(self) -> None:
        segments = [
            {"place_name": "景點A"},
        ]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=1,
            constraints=PlannerConstraints(must_visit=["不存在的地方"]),
            preferences=[],
        )
        self.assertIn("不存在的地方", result.must_visit_missing)
        self.assertFalse(result.feasible)

    def test_multi_day_distribution(self) -> None:
        segments = [{"place_name": f"景點{i}"} for i in range(8)]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=2,
            constraints=PlannerConstraints(pace="慢"),
            preferences=[],
        )
        self.assertEqual(len(result.days), 2)
        self.assertLessEqual(len(result.days[0].slots), 4)

    def test_response_format(self) -> None:
        segments = [{"place_name": "Test", "lat": 25.0, "lng": 121.0}]
        result = plan_itinerary_v2(segments, 1, PlannerConstraints(), [])
        response = planner_result_to_response(result)
        self.assertIn("feasible", response)
        self.assertIn("days", response)
        self.assertIn("warnings", response)
        self.assertIn("slots", response["days"][0])

    @patch("app.planner.fetch_google_directions_minutes", return_value=22)
    def test_use_google_directions_when_key_provided(self, mocked_directions) -> None:
        segments = [
            {"place_name": "台北101", "lat": 25.0339, "lng": 121.5645, "stay_minutes": 60, "estimated_cost": 100},
            {"place_name": "西門町", "lat": 25.0421, "lng": 121.5081, "stay_minutes": 60, "estimated_cost": 100},
        ]
        result = plan_itinerary_v2(
            segments=segments,
            days_count=1,
            constraints=PlannerConstraints(google_maps_api_key="fake-key", transport_pref="transit"),
            preferences=[],
        )
        self.assertEqual(len(result.days[0].slots), 2)
        self.assertEqual(result.days[0].slots[1].travel_minutes_from_prev, 22)
        self.assertEqual(result.days[0].slots[1].travel_time_source, "directions_api")
        self.assertTrue(mocked_directions.called)


if __name__ == "__main__":
    unittest.main()
