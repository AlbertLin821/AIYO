from __future__ import annotations

import random
from locust import HttpUser, between, task


WEATHER_QUERIES = [
    "今天天氣如何",
    "台北明天會下雨嗎",
    "高雄現在幾度",
]
CHAT_QUERIES = [
    "請依我的預算推薦台北兩日美食行程",
    "我想去台南三天兩夜，有什麼推薦嗎",
    "花蓮有哪些適合親子的景點",
    "推薦一些小資背包客的旅遊影片",
    "日月潭附近有什麼好玩的",
]
SEARCH_QUERIES = [
    "夜市 台北",
    "溫泉 北投",
    "登山 合歡山",
]


class AIYOChatUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        self.email = f"loadtest_{random.randint(1000, 9999)}@example.com"
        self.password = "pass1234"
        self.token = ""
        self.register_or_login()

    def register_or_login(self):
        register = self.client.post(
            "/api/auth/register",
            json={"email": self.email, "password": self.password},
            name="/api/auth/register",
        )
        if register.status_code not in (201, 409):
            return
        login = self.client.post(
            "/api/auth/login",
            json={"email": self.email, "password": self.password},
            name="/api/auth/login",
        )
        if login.status_code == 200:
            data = login.json()
            self.token = data.get("access_token") or data.get("token") or ""

    def _auth_headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(4)
    def chat_general(self):
        if not self.token:
            self.register_or_login()
            if not self.token:
                return
        self.client.post(
            "/api/chat",
            json={
                "sessionId": f"user-load-{self.email}",
                "message": random.choice(CHAT_QUERIES),
                "messages": [],
                "stream": False,
            },
            headers=self._auth_headers(),
            name="/api/chat",
        )

    @task(2)
    def chat_weather(self):
        if not self.token:
            self.register_or_login()
            if not self.token:
                return
        self.client.post(
            "/api/chat",
            json={
                "sessionId": f"user-load-{self.email}",
                "message": random.choice(WEATHER_QUERIES),
                "messages": [],
                "stream": False,
                "city": "台北",
            },
            headers=self._auth_headers(),
            name="/api/chat [weather]",
        )

    @task(2)
    def search_segments(self):
        if not self.token:
            return
        self.client.post(
            "/api/search-segments",
            json={"query": random.choice(SEARCH_QUERIES), "limit": 5},
            headers=self._auth_headers(),
            name="/api/search-segments",
        )

    @task(1)
    def get_memory(self):
        if not self.token:
            return
        self.client.get(
            "/api/user/memory?limit=8",
            headers=self._auth_headers(),
            name="/api/user/memory",
        )

    @task(1)
    def get_recommendation_metrics(self):
        if not self.token:
            return
        self.client.get(
            "/api/recommendation/metrics?days=7",
            headers=self._auth_headers(),
            name="/api/recommendation/metrics",
        )

    @task(1)
    def track_recommendation_event(self):
        if not self.token:
            return
        self.client.post(
            "/api/recommendation/event",
            json={
                "event_type": "impression",
                "session_id": f"user-load-{self.email}",
                "youtube_id": "dQw4w9WgXcQ",
                "rank_position": 1,
                "rank_score": 3.5,
            },
            headers=self._auth_headers(),
            name="/api/recommendation/event",
        )

    @task(1)
    def health_check(self):
        self.client.get("/health", name="/health")

    @task(1)
    def get_profile(self):
        if not self.token:
            return
        self.client.get(
            "/api/user/profile",
            headers=self._auth_headers(),
            name="/api/user/profile",
        )
