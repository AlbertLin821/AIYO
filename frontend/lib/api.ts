export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

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

export async function refreshAccessToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("refresh failed");
  }
  const data = (await response.json().catch(() => ({}))) as {
    token?: string;
    access_token?: string;
  };
  const token = data.access_token || data.token || "";
  if (!token) {
    throw new Error("refresh token missing");
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem("aiyo_token", token);
  }
  return token;
}

export async function apiFetchWithAuth(
  url: string,
  init?: RequestInit,
  allowRetry = true,
): Promise<Response> {
  const token = getAccessToken();
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
  const refreshedToken = await refreshAccessToken();
  return fetch(url, {
    ...(init ?? {}),
    credentials: "include",
    headers: getAuthHeaders(
      (init?.headers as Record<string, string> | undefined) ?? {},
      refreshedToken,
    ),
  });
}
