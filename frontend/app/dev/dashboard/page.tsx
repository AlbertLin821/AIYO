"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DevUser {
  id: number;
  email: string;
  created_at: string;
  display_name?: string;
  bio?: string;
}

interface AuditLog {
  id: number;
  trace_id?: string;
  user_id?: number;
  session_id?: string;
  endpoint?: string;
  method?: string;
  status_code?: number;
  request_json?: Record<string, unknown>;
  response_json?: Record<string, unknown>;
  ai_prompt_json?: Record<string, unknown>;
  ai_response_json?: Record<string, unknown>;
  tool_calls_json?: unknown[];
  error_text?: string;
  duration_ms?: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devFetch(path: string) {
  const token = sessionStorage.getItem("dev_token") || "";
  return fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function formatDate(d: string | undefined) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleString("zh-TW");
  } catch {
    return d;
  }
}

function JsonBlock({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (data === null || data === undefined) return <span className="text-muted">null</span>;
  const text = JSON.stringify(data, null, 2);
  if (text.length < 120) {
    return <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{text}</pre>;
  }
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="mb-1 text-xs text-primary underline"
      >
        {expanded ? "collapse" : `expand (${text.length} chars)`}
      </button>
      {expanded && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-muted p-2 text-xs text-muted-foreground">
          {text}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabName = "users" | "audit";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DevDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabName>("users");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const token = sessionStorage.getItem("dev_token");
    const em = sessionStorage.getItem("dev_email");
    if (!token) {
      router.replace("/dev/login");
      return;
    }
    setEmail(em || "dev");
  }, [router]);

  function handleLogout() {
    sessionStorage.removeItem("dev_token");
    sessionStorage.removeItem("dev_email");
    router.replace("/dev/login");
  }

  return (
    <div className="min-h-screen bg-surface-canvas text-primary">
      {/* header */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3 shadow-card">
        <h1 className="text-lg font-bold text-primary">AIYO Dev Console</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">{email}</span>
          <button onClick={handleLogout} className="text-red-600 hover:underline">
            Logout
          </button>
        </div>
      </header>

      {/* tab bar */}
      <nav className="flex gap-1 border-b border-border bg-surface px-6 pt-2">
        {(["users", "audit"] as TabName[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-4 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-primary text-primary" : "text-muted hover:text-muted-foreground"
            }`}
          >
            {t === "users" ? "Users" : "Audit Logs"}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-7xl p-6">
        {tab === "users" && <UsersTab />}
        {tab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------

function UsersTab() {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    devFetch("/api/dev/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => {});
  }, []);

  return (
    <div className="flex gap-6">
      {/* user list */}
      <div className="w-64 shrink-0">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">User List</h2>
        <ul className="space-y-1">
          {users.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => setSelectedId(u.id)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  selectedId === u.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-surface-muted"
                }`}
              >
                <span className="mr-1 text-xs text-muted">#{u.id}</span>
                {u.email}
              </button>
            </li>
          ))}
          {users.length === 0 && <li className="px-3 py-2 text-xs text-muted">No users</li>}
        </ul>
      </div>

      {/* user detail */}
      <div className="min-w-0 flex-1">
        {selectedId ? <UserDetail userId={selectedId} /> : (
          <p className="pt-12 text-center text-sm text-muted">
            Select a user to view details
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Detail
// ---------------------------------------------------------------------------

type DetailSection = "profile" | "memories" | "chat" | "itineraries";

function UserDetail({ userId }: { userId: number }) {
  const [section, setSection] = useState<DetailSection>("profile");

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(["profile", "memories", "chat", "itineraries"] as DetailSection[]).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              section === s ? "bg-primary text-primary-foreground" : "bg-surface-muted text-primary hover:bg-surface-hover"
            }`}
          >
            {s === "profile" ? "Profile" : s === "memories" ? "Memories" : s === "chat" ? "Chat" : "Itineraries"}
          </button>
        ))}
      </div>

      {section === "profile" && <ProfileSection userId={userId} />}
      {section === "memories" && <MemoriesSection userId={userId} />}
      {section === "chat" && <ChatSection userId={userId} />}
      {section === "itineraries" && <ItinerariesSection userId={userId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileSection({ userId }: { userId: number }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    devFetch(`/api/dev/users/${userId}/profile`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [userId]);
  if (!data) return <p className="text-sm text-muted">Loading...</p>;
  return (
    <div className="space-y-4">
      <Section title="User">{data.user ? <JsonBlock data={data.user as Record<string, unknown>} /> : <Empty />}</Section>
      <Section title="Profile">{data.profile ? <JsonBlock data={data.profile as Record<string, unknown>} /> : <Empty />}</Section>
      <Section title="AI Settings">{data.ai_settings ? <JsonBlock data={data.ai_settings as Record<string, unknown>} /> : <Empty />}</Section>
    </div>
  );
}

function MemoriesSection({ userId }: { userId: number }) {
  const [memories, setMemories] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    devFetch(`/api/dev/users/${userId}/memories?limit=100`)
      .then((r) => r.json())
      .then((d) => setMemories(d.memories || []))
      .catch(() => {});
  }, [userId]);
  if (memories.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {memories.map((m, i) => (
        <div key={i} className="rounded border border-border bg-surface p-3">
          <JsonBlock data={m} />
        </div>
      ))}
    </div>
  );
}

function ChatSection({ userId }: { userId: number }) {
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    devFetch(`/api/dev/users/${userId}/chat-sessions?limit=50`)
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions || []); setSelectedSession(null); setMessages([]); })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!selectedSession) return;
    devFetch(`/api/dev/users/${userId}/chat-history/${selectedSession}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => {});
  }, [userId, selectedSession]);

  return (
    <div className="flex gap-4">
      <div className="w-52 shrink-0 space-y-1">
        <p className="mb-2 text-xs font-semibold text-muted">Sessions</p>
        {sessions.map((s) => {
          const sid = String((s as Record<string, unknown>).session_id || "");
          return (
            <button
              key={sid}
              onClick={() => setSelectedSession(sid)}
              className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
                selectedSession === sid ? "bg-primary/10 text-primary" : "hover:bg-surface-muted"
              }`}
            >
              {String((s as Record<string, unknown>).title || sid).slice(0, 40)}
              <span className="block text-[10px] text-muted">
                {formatDate(String((s as Record<string, unknown>).updated_at || ""))}
              </span>
            </button>
          );
        })}
        {sessions.length === 0 && <Empty />}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        {messages.length === 0 && <p className="pt-4 text-xs text-muted">Select a session</p>}
        {messages.map((m, i) => {
          const role = String((m as Record<string, unknown>).role || "user");
          const content = String((m as Record<string, unknown>).content || "");
          return (
            <div
              key={i}
              className={`rounded border border-border p-3 text-sm ${
                role === "assistant" ? "border-primary/20 bg-primary/5" : "bg-surface"
              }`}
            >
              <span className="mr-2 text-xs font-bold text-muted">{role}</span>
              <span className="block text-[10px] text-muted">{formatDate(String((m as Record<string, unknown>).created_at || ""))}</span>
              <p className="mt-1 whitespace-pre-wrap">{content}</p>
              {(m as Record<string, unknown>).metadata ? (
                <div className="mt-2">
                  <JsonBlock data={(m as Record<string, unknown>).metadata as Record<string, unknown>} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItinerariesSection({ userId }: { userId: number }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    devFetch(`/api/dev/users/${userId}/itineraries`)
      .then((r) => r.json())
      .then((d) => setItems(d.itineraries || []))
      .catch(() => {});
  }, [userId]);
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded border border-border bg-surface p-3">
          <JsonBlock data={it} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Tab
// ---------------------------------------------------------------------------

function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterUser, setFilterUser] = useState("");
  const [filterEndpoint, setFilterEndpoint] = useState("");
  const [filterTrace, setFilterTrace] = useState("");
  const pageSize = 30;

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    if (filterUser) params.set("user_id", filterUser);
    if (filterEndpoint) params.set("endpoint", filterEndpoint);
    if (filterTrace) params.set("trace_id", filterTrace);
    devFetch(`/api/dev/audit-logs?${params}`)
      .then((r) => r.json())
      .then((d) => { setLogs(d.logs || []); setTotal(d.total || 0); })
      .catch(() => {});
  }, [page, filterUser, filterEndpoint, filterTrace]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {/* filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          User ID
          <input
            className="ml-1 w-20 rounded border px-2 py-1 text-xs"
            value={filterUser}
            onChange={(e) => { setFilterUser(e.target.value); setPage(0); }}
          />
        </label>
        <label className="text-xs text-muted">
          Endpoint
          <input
            className="ml-1 w-32 rounded border px-2 py-1 text-xs"
            value={filterEndpoint}
            onChange={(e) => { setFilterEndpoint(e.target.value); setPage(0); }}
          />
        </label>
        <label className="text-xs text-muted">
          Trace ID
          <input
            className="ml-1 w-48 rounded border px-2 py-1 text-xs"
            value={filterTrace}
            onChange={(e) => { setFilterTrace(e.target.value); setPage(0); }}
          />
        </label>
        <button onClick={load} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90">
          Search
        </button>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-xs">
          <thead className="bg-surface-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Trace</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <AuditRow key={log.id} log={log} />
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  No logs
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pager */}
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{total} results</span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="rounded border px-2 py-1 disabled:opacity-30"
          >
            Prev
          </button>
          <span className="px-1 py-1">
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
            className="rounded border px-2 py-1 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-border hover:bg-surface-muted/50">
        <td className="px-3 py-2">{log.id}</td>
        <td className="max-w-[100px] truncate px-3 py-2" title={log.trace_id}>{log.trace_id || "-"}</td>
        <td className="px-3 py-2">{log.user_id ?? "-"}</td>
        <td className="px-3 py-2">{log.endpoint || "-"}</td>
        <td className="px-3 py-2">
          <span className={log.status_code && log.status_code >= 400 ? "text-red-600" : "text-green-700"}>
            {log.status_code ?? "-"}
          </span>
        </td>
        <td className="px-3 py-2">{log.duration_ms != null ? `${log.duration_ms}ms` : "-"}</td>
        <td className="max-w-[160px] truncate px-3 py-2 text-red-500" title={log.error_text || ""}>
          {log.error_text || "-"}
        </td>
        <td className="whitespace-nowrap px-3 py-2">{formatDate(log.created_at)}</td>
        <td className="px-3 py-2">
          <button onClick={() => setOpen(!open)} className="text-primary underline">
            {open ? "hide" : "show"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-surface-muted/50">
          <td colSpan={9} className="space-y-3 px-4 py-3">
            <DetailBlock title="Request" data={log.request_json} />
            <DetailBlock title="Response" data={log.response_json} />
            <DetailBlock title="AI Prompt" data={log.ai_prompt_json} />
            <DetailBlock title="AI Response" data={log.ai_response_json} />
            <DetailBlock title="Tool Calls" data={log.tool_calls_json} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetailBlock({ title, data }: { title: string; data: unknown }) {
  if (!data || (typeof data === "object" && Object.keys(data as Record<string, unknown>).length === 0)) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{title}</p>
      <JsonBlock data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="py-4 text-center text-xs text-muted">No data</p>;
}
