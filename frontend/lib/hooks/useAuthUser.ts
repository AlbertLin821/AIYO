"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";

export type AuthUser = {
  name: string;
  username: string;
  avatar?: string;
};

export function useAuthUser(): { user: AuthUser | null; loading: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await apiFetchWithAuth(`${API_BASE_URL}/api/auth/me`);
        if (!active) return;
        if (!response.ok) {
          if (typeof window !== "undefined") window.localStorage.removeItem("aiyo_token");
          setUser(null);
          setLoading(false);
          return;
        }
        const data = (await response.json()) as { user?: { id?: number; email?: string } };
        const email = data.user?.email ?? "";
        const part = email.split("@")[0] || "User";
        setUser({ name: part, username: part, avatar: undefined });
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}
