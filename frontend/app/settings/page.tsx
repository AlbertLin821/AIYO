"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  User,
  Shield,
  Compass,
  Bell,
  LogOut,
  KeyRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";
import { cn } from "@/lib/utils";

type SettingsTab = "profile" | "account" | "travel" | "notifications";

type UserProfile = {
  display_name?: string | null;
  travel_style?: string | null;
  budget_pref?: string | null;
  pace_pref?: string | null;
  transport_pref?: string | null;
  dietary_pref?: string | null;
  preferred_cities?: string[] | null;
};

type UserAiSettings = {
  tool_policy_json?: {
    enabled?: boolean;
    weather_use_current_location?: boolean;
    tool_trigger_rules?: string;
  } | null;
  weather_default_region?: string | null;
  auto_use_current_location?: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const { user: sidebarUser } = useAuthUser();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [authEmail, setAuthEmail] = useState("");
  const [profile, setProfile] = useState<UserProfile>({});
  const [aiSettings, setAiSettings] = useState<UserAiSettings>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryItems, setMemoryItems] = useState<Array<{ id: number; memory_text: string; memory_type: string }>>([]);
  const [memoryReviewing, setMemoryReviewing] = useState(false);

  const NOTIFICATION_STORAGE_KEY = "aiyo_notification_prefs";
  const defaultNotif = {
    tripReminders: true,
    aiSuggestions: true,
    sharedTripUpdates: true,
    newFeatures: true,
  };
  const [notifications, setNotifications] = useState(defaultNotif);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" && window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<typeof defaultNotif>;
        setNotifications((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  function setNotification(key: keyof typeof defaultNotif, value: boolean) {
    setNotifications((prev) => {
      const next = { ...prev, [key]: value };
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setNotice("通知偏好已更新。");
    setTimeout(() => setNotice(null), 2000);
  }

  useEffect(() => {
    async function init() {
      const token = getAccessToken();
      if (!token) { router.replace("/login"); return; }
      try {
        const [meRes, profileRes, aiRes, memRes] = await Promise.all([
          apiFetchWithAuth(`${API_BASE_URL}/api/auth/me`),
          apiFetchWithAuth(`${API_BASE_URL}/api/user/profile`),
          apiFetchWithAuth(`${API_BASE_URL}/api/user/ai-settings`),
          apiFetchWithAuth(`${API_BASE_URL}/api/user/memory?limit=8`),
        ]);
        if (meRes.status === 401) { router.replace("/login"); return; }
        if (meRes.ok) {
          const data = (await meRes.json()) as { user?: { email?: string } };
          setAuthEmail(data.user?.email ?? "");
        }
        if (profileRes.ok) {
          const data = (await profileRes.json()) as { profile?: UserProfile };
          setProfile(data.profile || {});
        }
        if (aiRes.ok) {
          const data = (await aiRes.json()) as { settings?: UserAiSettings };
          setAiSettings(data.settings || {});
        }
        if (memRes.ok) {
          const data = (await memRes.json()) as { items?: Array<{ id: number; memory_text: string; memory_type: string }> };
          setMemoryItems(data.items || []);
        }
      } catch {
        setError("無法載入設定。");
      }
    }
    void init();
  }, [router]);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await apiFetchWithAuth(`${API_BASE_URL}/api/user/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profile.display_name ?? null,
          travelStyle: profile.travel_style ?? null,
          budgetPref: profile.budget_pref ?? null,
          pacePref: profile.pace_pref ?? null,
          transportPref: profile.transport_pref ?? null,
          dietaryPref: profile.dietary_pref ?? null,
          preferredCities: profile.preferred_cities ?? [],
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = (await res.json()) as { profile?: UserProfile };
      setProfile(data.profile || {});
      setNotice("個人資料已儲存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAiSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await apiFetchWithAuth(`${API_BASE_URL}/api/user/ai-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolPolicy: {
            enabled: aiSettings.tool_policy_json?.enabled ?? true,
            weather_use_current_location: aiSettings.tool_policy_json?.weather_use_current_location ?? true,
            tool_trigger_rules: aiSettings.tool_policy_json?.tool_trigger_rules ?? "",
          },
          weatherDefaultRegion: aiSettings.weather_default_region ?? null,
          autoUseCurrentLocation: aiSettings.auto_use_current_location ?? true,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = (await res.json()) as { settings?: UserAiSettings };
      setAiSettings(data.settings || {});
      setNotice("AI 設定已儲存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleMemoryReview() {
    if (memoryReviewing) return;
    setMemoryReviewing(true);
    setError(null);
    setNotice(null);
    try {
      const rebuildRes = await apiFetchWithAuth(`${API_BASE_URL}/api/user/memory/rebuild`, {
        method: "POST",
      });
      if (!rebuildRes.ok) throw new Error("Memory review failed");
      const result = (await rebuildRes.json()) as { inserted?: number; skipped?: number; candidates?: number };
      const memRes = await apiFetchWithAuth(`${API_BASE_URL}/api/user/memory?limit=8`);
      if (memRes.ok) {
        const data = (await memRes.json()) as { items?: Array<{ id: number; memory_text: string; memory_type: string }> };
        setMemoryItems(data.items || []);
      }
      setNotice(
        `Review complete: ${result.candidates ?? 0} candidates, ${result.inserted ?? 0} new, ${result.skipped ?? 0} skipped.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory review failed");
    } finally {
      setMemoryReviewing(false);
    }
  }

  function handleLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("aiyo_token");
    }
    router.replace("/login");
  }

  const tabItems = [
    { id: "profile" as const, label: "個人資料", icon: <User size={14} /> },
    { id: "account" as const, label: "帳戶", icon: <Shield size={14} /> },
    { id: "travel" as const, label: "旅遊偏好", icon: <Compass size={14} /> },
    { id: "notifications" as const, label: "通知", icon: <Bell size={14} /> },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={sidebarUser ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <h1 className="text-page-title text-primary">設定</h1>
          <p className="mt-1 text-sm text-muted">管理帳戶與偏好設定。</p>
          <div className="mt-6">
            <Tabs
              items={tabItems}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as SettingsTab)}
            />
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-8 py-8">
          {notice && (
            <div className="mb-6 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
              {notice}
            </div>
          )}
          {error && (
            <div className="mb-6 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          {activeTab === "profile" && (
            <form onSubmit={handleSaveProfile} className="space-y-8">
              <div>
                <h2 className="text-section-title text-primary">個人資料</h2>
                <p className="mt-1 text-sm text-muted">管理你的顯示名稱與聯絡信箱。</p>
              </div>

              <div className="rounded-card border border-border p-6">
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <Avatar
                    src={undefined}
                    fallback={(profile.display_name || authEmail || "U").charAt(0).toUpperCase()}
                    size="lg"
                    className="shrink-0"
                  />
                  <div className="flex-1 w-full text-center sm:text-left">
                    <p className="text-sm font-medium text-primary">大頭貼</p>
                    <p className="mt-0.5 text-xs text-muted">目前使用名稱縮寫作為頭像，頭像上傳功能即將推出。</p>
                  </div>
                </div>
              </div>

              <div className="rounded-card border border-border p-5 space-y-4">
                <h3 className="text-sm font-semibold text-primary">基本資訊</h3>
                <Input
                  label="顯示名稱"
                  value={profile.display_name ?? ""}
                  onChange={(e) => setProfile((prev) => ({ ...prev, display_name: e.target.value }))}
                  placeholder="你的名字或暱稱"
                  disabled={saving}
                />
                <Input
                  label="電子郵件"
                  value={authEmail}
                  disabled
                />
                <Button type="submit" disabled={saving}>
                  {saving ? "儲存中..." : "儲存變更"}
                </Button>
              </div>
            </form>
          )}

          {activeTab === "account" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-section-title text-primary">帳戶</h2>
                <p className="mt-1 text-sm text-muted">管理帳戶、AI 工具與安全設定。</p>
              </div>

              <div className="rounded-card border border-border p-5">
                <div className="flex items-center gap-2 mb-4">
                  <KeyRound size={18} className="text-muted" />
                  <h3 className="text-sm font-semibold text-primary">變更密碼</h3>
                </div>
                <p className="text-xs text-muted mb-4">
                  變更密碼功能即將推出，屆時可在此設定新密碼以提升帳戶安全。
                </p>
                <div className="space-y-3 opacity-60 pointer-events-none">
                  <Input label="目前密碼" type="password" placeholder="請輸入目前密碼" disabled />
                  <Input label="新密碼" type="password" placeholder="請輸入新密碼（至少 6 碼）" disabled />
                  <Input label="確認新密碼" type="password" placeholder="再次輸入新密碼" disabled />
                  <Button size="sm" disabled>即將推出</Button>
                </div>
              </div>

              <div className="rounded-card border border-border p-5">
                <h3 className="text-sm font-semibold text-primary">AI 工具設定</h3>
                <form onSubmit={handleSaveAiSettings} className="mt-4 space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={aiSettings.tool_policy_json?.enabled ?? true}
                      onChange={(e) =>
                        setAiSettings((prev) => ({
                          ...prev,
                          tool_policy_json: { ...(prev.tool_policy_json || {}), enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded"
                      disabled={saving}
                    />
                    <span className="text-sm text-primary">啟用 AI 工具呼叫</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={aiSettings.auto_use_current_location ?? true}
                      onChange={(e) =>
                        setAiSettings((prev) => ({ ...prev, auto_use_current_location: e.target.checked }))
                      }
                      className="h-4 w-4 rounded"
                      disabled={saving}
                    />
                    <span className="text-sm text-primary">天氣查詢時自動使用目前位置</span>
                  </label>
                  <Input
                    label="預設地區"
                    value={aiSettings.weather_default_region ?? ""}
                    onChange={(e) => setAiSettings((prev) => ({ ...prev, weather_default_region: e.target.value }))}
                    placeholder="例如：台北"
                    disabled={saving}
                  />
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "儲存中..." : "儲存 AI 設定"}
                  </Button>
                </form>
              </div>

              <div className="rounded-card border border-border p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-primary">AI 記憶</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleMemoryReview()}
                    disabled={memoryReviewing}
                  >
                    {memoryReviewing ? "檢視中..." : "檢視記憶"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  AIYO 會從對話中學習，以提供更貼合你的推薦。
                </p>
                {memoryItems.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {memoryItems.map((item) => (
                      <div key={item.id} className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-primary">
                        <span className="font-medium text-muted">[{item.memory_type}]</span>{" "}
                        {item.memory_text}
                      </div>
                    ))}
                  </div>
                )}
                {memoryItems.length === 0 && (
                  <p className="mt-4 text-xs text-muted">尚無記憶資料。</p>
                )}
              </div>

              <div className="rounded-card border border-danger/20 p-5">
                <h3 className="text-sm font-semibold text-danger">危險操作</h3>
                <p className="mt-1 text-sm text-muted">
                  登出後需重新登入。刪除帳戶將永久移除所有資料。
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                  >
                    <LogOut size={14} className="mr-1.5" />
                    登出
                  </Button>
                  <Button variant="outline" size="sm" className="border-danger text-danger hover:bg-danger/10">
                    刪除帳戶
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "travel" && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div>
                <h2 className="text-section-title text-primary">旅遊偏好</h2>
                <p className="mt-1 text-sm text-muted">
                  填寫偏好可讓 AIYO 推薦更符合你的行程。
                </p>
              </div>
              <Input
                label="旅遊風格"
                value={profile.travel_style ?? ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, travel_style: e.target.value }))}
                placeholder="例如：文化、美食、親子、冒險"
                disabled={saving}
              />
              <Input
                label="預算偏好"
                value={profile.budget_pref ?? ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, budget_pref: e.target.value }))}
                placeholder="例如：省錢、中等、奢華"
                disabled={saving}
              />
              <Input
                label="步調偏好"
                value={profile.pace_pref ?? ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, pace_pref: e.target.value }))}
                placeholder="例如：悠閒、適中、緊湊"
                disabled={saving}
              />
              <Input
                label="交通偏好"
                value={profile.transport_pref ?? ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, transport_pref: e.target.value }))}
                placeholder="例如：大眾運輸、開車、步行"
                disabled={saving}
              />
              <Input
                label="飲食限制"
                value={profile.dietary_pref ?? ""}
                onChange={(e) => setProfile((prev) => ({ ...prev, dietary_pref: e.target.value }))}
                placeholder="例如：素食、清真、不吃牛"
                disabled={saving}
              />
              <Button type="submit" disabled={saving}>
                {saving ? "儲存中..." : "儲存偏好"}
              </Button>
            </form>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-section-title text-primary">通知</h2>
                <p className="mt-1 text-sm text-muted">選擇你想收到的通知類型，偏好會儲存在本機。</p>
              </div>

              <div className="space-y-4">
                {[
                  { key: "tripReminders" as const, label: "行程提醒", desc: "即將出發的行程提醒" },
                  { key: "aiSuggestions" as const, label: "AI 推薦", desc: "個人化旅遊建議" },
                  { key: "sharedTripUpdates" as const, label: "共編行程更新", desc: "協作者編輯行程時通知" },
                  { key: "newFeatures" as const, label: "新功能", desc: "AIYO 新功能與更新" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-card border border-border p-4">
                    <div>
                      <p className="text-sm font-medium text-primary">{item.label}</p>
                      <p className="text-xs text-muted">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifications[item.key]}
                      onClick={() => setNotification(item.key, !notifications[item.key])}
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20",
                        notifications[item.key] ? "bg-primary" : "bg-surface-muted"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-1 h-4 w-4 rounded-full bg-primary-foreground transition-transform",
                          notifications[item.key] ? "left-6" : "left-1"
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
