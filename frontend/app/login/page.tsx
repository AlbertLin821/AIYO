"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

type AuthMode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const token = window.localStorage.getItem("aiyo_token");
    if (token) {
      router.replace("/");
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("請輸入 email 與密碼。");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password
        })
      });
      const data = (await response.json().catch(() => ({}))) as { token?: string; access_token?: string; error?: string };
      const token = data.access_token || data.token || "";
      if (!response.ok || !token) {
        throw new Error(data.error || "登入失敗。");
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("aiyo_token", token);
      }
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登入失敗。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">AIYO 帳號登入</h1>
        <p className="mb-4 text-sm text-slate-600">登入後即可使用個人化旅遊規劃功能。</p>

        <div className="mb-4 flex gap-2">
          <button
            className={`rounded px-3 py-1 text-sm ${mode === "login" ? "bg-slate-900 text-white" : "border"}`}
            onClick={() => setMode("login")}
            type="button"
          >
            登入
          </button>
          <button
            className={`rounded px-3 py-1 text-sm ${mode === "register" ? "bg-slate-900 text-white" : "border"}`}
            onClick={() => setMode("register")}
            type="button"
          >
            註冊
          </button>
        </div>

        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
            />
          </label>
          <label className="block text-sm">
            密碼
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button className="w-full rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-60" disabled={loading} type="submit">
            {loading ? "處理中..." : mode === "login" ? "登入" : "註冊"}
          </button>
        </form>
      </section>
    </main>
  );
}
