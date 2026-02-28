from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.tools.agent import extract_tool_calls, get_tool_schemas
from app.tools.weather import infer_weather_region


class ToolSchemaTests(unittest.TestCase):
    def test_tool_schemas_with_all_flags(self) -> None:
        schemas = get_tool_schemas(
            {
                "weather": True,
                "youtube": True,
                "transport": True,
                "travel_info": True,
            }
        )
        names = [item.get("function", {}).get("name") for item in schemas]
        self.assertIn("get_current_time", names)
        self.assertIn("get_weather", names)
        self.assertIn("search_youtube_videos", names)
        self.assertIn("search_travel_information", names)
        self.assertIn("search_transport_options", names)

    def test_extract_tool_calls(self) -> None:
        message = {
            "tool_calls": [
                {"function": {"name": "get_weather", "arguments": "{\"location\":\"台北\"}"}},
                {"name": "search_travel_information", "arguments": {"query": "台南 活動"}},
            ]
        }
        calls = extract_tool_calls(message)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["name"], "get_weather")
        self.assertEqual(calls[0]["arguments"]["location"], "台北")


class WeatherRegionResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_prefers_explicit_region(self) -> None:
        result = await infer_weather_region(
            explicit_region="高雄",
            query="現在天氣如何",
            user_ai_settings={},
            default_region="台北",
            user_agent="test-agent",
        )
        self.assertEqual(result["region"], "高雄")
        self.assertEqual(result["location_source"], "tool_argument")

    async def test_uses_current_region_when_query_is_weather(self) -> None:
        result = await infer_weather_region(
            explicit_region="",
            query="今天天氣如何",
            user_ai_settings={"current_region": "台中", "auto_use_current_location": True},
            default_region="台北",
            user_agent="test-agent",
        )
        self.assertEqual(result["region"], "台中")
        self.assertEqual(result["location_source"], "current_region")


class WeatherToolArgumentTests(unittest.TestCase):
    def test_extract_weather_location_accepts_city_alias(self) -> None:
        from app.tools.agent import _extract_weather_location

        self.assertEqual(_extract_weather_location({"city": "台北"}), "台北")
        self.assertEqual(_extract_weather_location({"region": "高雄"}), "高雄")

    def test_extract_weather_location_accepts_nested_location(self) -> None:
        from app.tools.agent import _extract_weather_location

        self.assertEqual(_extract_weather_location({"location": {"city": "台中"}}), "台中")
        self.assertEqual(_extract_weather_location({"location": {"name": "台南"}}), "台南")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payloads):
        self._payloads = list(payloads)

    async def post(self, *_args, **_kwargs):
        if not self._payloads:
            return _FakeResponse({"message": {"content": ""}})
        return _FakeResponse(self._payloads.pop(0))


class ResolveToolContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_force_weather_tool_when_model_skips_tool_call(self) -> None:
        from app.tools import agent as agent_module

        fake_client = _FakeClient(
            [
                {"message": {"content": "請問您想查詢哪個地區或城市的天氣呢？"}},
                {"message": {"content": "台中今天多雲，氣溫約 22 度。"}},
            ]
        )
        fake_weather_handler = AsyncMock(
            return_value={
                "ok": True,
                "source": "open-meteo",
                "data": {"region": "台中", "location_source": "current_region"},
                "error": None,
            }
        )

        with patch.object(agent_module, "get_tool_schemas", return_value=[]), patch.object(
            agent_module,
            "build_tool_executor",
            return_value={"get_weather": fake_weather_handler},
        ):
            resolved = await agent_module.resolve_tool_context(
                client=fake_client,
                ollama_base_url="http://fake-ollama",
                model="fake-model",
                base_messages=[{"role": "user", "content": "今天天氣如何"}],
                context={
                    "last_user_message": "今天天氣如何",
                    "default_timezone": "Asia/Taipei",
                    "default_region": None,
                    "user_ai_settings": {},
                    "http_user_agent": "test-agent",
                },
                tool_flags={"weather": True},
                max_rounds=3,
                max_calls_per_round=2,
            )

        self.assertTrue(resolved["used_tools"])
        self.assertEqual(resolved["direct_reply"], "台中今天多雲，氣溫約 22 度。")
        self.assertTrue(any(item.get("tool") == "get_weather" for item in resolved["tool_calls_summary"]))
        fake_weather_handler.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
