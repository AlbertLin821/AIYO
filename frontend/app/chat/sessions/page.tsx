"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, getAccessToken, apiFetchWithAuth, clearAccessToken } from "@/lib/api";

type ChatSessionItem = {
  id: number;
  external_session_id: string | null;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export default function ChatSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetchWithAuth(`${API_BASE_URL}/api/chat/sessions`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            clearAccessToken();
            router.replace("/login");
            return;
          }
          throw new Error("無法載入對話清單");
        }
        return res.json();
      })
      .then((data: { sessions?: ChatSessionItem[] } | undefined) => {
        if (alive && data && Array.isArray(data.sessions)) {
          setSessions(data.sessions);
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "載入失敗");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSession(sessionId: string) {
    const params = new URLSearchParams();
    params.set("session", sessionId);
    router.push(`/?${params.toString()}`);
  }

  function openNewChat() {
    const newId = `session-${Date.now()}`;
    const params = new URLSearchParams();
    params.set("session", newId);
    router.push(`/?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-2xl">
        <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <h1 className="text-lg font-semibold text-slate-800">歷史對話清單</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
              onClick={() => router.push("/")}
            >
              返回首頁
            </button>
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
              onClick={openNewChat}
            >
              新對話
            </button>
          </div>
        </header>

        {loading && <p className="text-sm text-slate-500">載入中...</p>}
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-slate-500">尚無對話紀錄，請在首頁開始新對話。</p>
        )}
        {!loading && sessions.length > 0 && (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const sid = s.external_session_id ?? String(s.id);
              const title = (s.title || "旅遊對話").trim() || "未命名對話";
              const sub = formatDate(s.last_message_at || s.created_at);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="w-full rounded border border-slate-200 bg-white p-3 text-left text-sm hover:bg-slate-50"
                    onClick={() => openSession(sid)}
                  >
                    <p className="font-medium text-slate-800">{title}</p>
                    <p className="mt-1 text-xs text-slate-500">{sub}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
