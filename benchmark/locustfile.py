from __future__ import annotations

import random
from locust import HttpUser, between, task


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

    @task(3)
    def chat(self):
        if not self.token:
            self.register_or_login()
            if not self.token:
                return
        self.client.post(
            "/api/chat",
            json={
                "sessionId": f"user-load-{self.email}",
                "message": "請依我的預算推薦台北兩日美食行程",
                "messages": [],
                "stream": False,
            },
            headers={"Authorization": f"Bearer {self.token}"},
            name="/api/chat",
        )

    @task(1)
    def get_memory(self):
        if not self.token:
            return
        self.client.get(
            "/api/user/memory?limit=8",
            headers={"Authorization": f"Bearer {self.token}"},
            name="/api/user/memory",
        )
