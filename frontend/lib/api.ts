export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

/** 與首頁行程／聊天工作階段共用，登出時一併清除 */
export const STORAGE_CHAT_SESSION_ID = "aiyo_chat_session_id";
export const STORAGE_ACTIVE_ITINERARY_ID = "aiyo_active_itinerary_id";
export const STORAGE_LAST_AUTH_USER_ID = "aiyo_last_auth_user_id";

export function getAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem("aiyo_token") ?? "";
}

export function getAuthHeaders(
  extra?: Record<string, string>,
  tokenOverride?: string,
): Record<string, string> {
  const token = tokenOverride ?? getAccessToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function clearAccessToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem("aiyo_token");
  window.localStorage.removeItem(STORAGE_CHAT_SESSION_ID);
  window.localStorage.removeItem(STORAGE_ACTIVE_ITINERARY_ID);
  window.localStorage.removeItem(STORAGE_LAST_AUTH_USER_ID);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("aiyo_recommended_")) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

let refreshPromise: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        clearAccessToken();
        throw new Error("refresh failed");
      }
      const data = (await response.json().catch(() => ({}))) as {
        token?: string;
        access_token?: string;
      };
      const token = data.access_token || data.token || "";
      if (!token) {
        clearAccessToken();
        throw new Error("refresh token missing");
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("aiyo_token", token);
      }
      return token;
    } catch (err) {
      clearAccessToken();
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetchWithAuth(
  url: string,
  init?: RequestInit,
  allowRetry = true,
): Promise<Response> {
  const token = getAccessToken();
  if (!token && allowRetry) {
    return new Response(JSON.stringify({ error: "not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const response = await fetch(url, {
    ...(init ?? {}),
    credentials: "include",
    headers: getAuthHeaders(
      (init?.headers as Record<string, string> | undefined) ?? {},
      token || "",
    ),
  });
  if (response.status !== 401 || !allowRetry) {
    return response;
  }
  try {
    const refreshedToken = await refreshAccessToken();
    return fetch(url, {
      ...(init ?? {}),
      credentials: "include",
      headers: getAuthHeaders(
        (init?.headers as Record<string, string> | undefined) ?? {},
        refreshedToken,
      ),
    });
  } catch {
    return response;
  }
}
