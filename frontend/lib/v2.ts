import { API_BASE_URL, apiFetchWithAuth, getAccessToken } from "@/lib/api";

export type VoiceIntentV2 = {
  destination: string | null;
  days: number;
  budget: string | null;
  preferences: string[];
  traceId: string;
};

export type RenderableItemV2 = {
  internalPlaceId: string | null;
  googlePlaceId: string | null;
  segmentId: string | null;
  lat: number | null;
  lng: number | null;
  startSec: number | null;
  endSec: number | null;
  reason: string[];
  statsUpdatedAt: string | null;
  statsStale: boolean;
  geocodeStatus?: "ok" | "failed" | "pending";
  geocodeRetryCount?: number;
  placeName?: string | null;
  videoTitle?: string | null;
  youtubeId?: string | null;
  viewCount?: number;
  likeCount?: number;
};

export type RecommendResultV2 = {
  items: RenderableItemV2[];
  candidateCount?: number;
  embedModel?: string;
  embedVersion?: string;
  embedDim?: number;
  traceId?: string;
};

export type PlanStopV2 = RenderableItemV2 & {
  placeName?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
  travelMinutesFromPrev?: number | null;
  travelMode?: string | null;
};

export type PlanDayV2 = {
  dayNumber?: number;
  warnings?: string[];
  stops: PlanStopV2[];
};

export type PlanResultV2 = {
  feasible?: boolean;
  warnings?: string[];
  days: PlanDayV2[];
  unmappedSegments?: RenderableItemV2[];
};

export type PlanResponseV2 = {
  traceId: string;
  recommendations: RenderableItemV2[];
  plan: PlanResultV2;
  embedModel?: string;
  embedVersion?: string;
  embedDim?: number;
};

export type JobStateV2 = {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  traceId?: string;
  pollAfterMs?: number;
  createdAt?: string;
  updatedAt?: string;
};

const API_V2_BASE = `${API_BASE_URL}/api/v2`;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const message = (data as { error?: string }).error || `request failed: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function parseVoiceIntentV2(text: string): Promise<VoiceIntentV2> {
  const response = await apiFetchWithAuth(`${API_V2_BASE}/voice/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  return parseJsonResponse<VoiceIntentV2>(response);
}

type RecommendPayload = {
  query?: string;
  destination?: string | null;
  days?: number;
  budget?: string | null;
  preferences?: string[];
  limit?: number;
  traceId?: string;
};

type RecommendSyncResponse = {
  status?: "completed";
  result?: RecommendResultV2;
  traceId?: string;
};

type AsyncAcceptedResponse = {
  jobId: string;
  pollAfterMs: number;
  traceId?: string;
};

export async function recommendVideosV2(
  payload: RecommendPayload
): Promise<RecommendSyncResponse | AsyncAcceptedResponse> {
  const response = await apiFetchWithAuth(`${API_V2_BASE}/recommend/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<RecommendSyncResponse | AsyncAcceptedResponse>(response);
}

export async function getRecommendJobV2(jobId: string): Promise<JobStateV2> {
  const response = await apiFetchWithAuth(`${API_V2_BASE}/recommend/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET"
  });
  return parseJsonResponse<JobStateV2>(response);
}

type PlanPayload = {
  query?: string;
  destination?: string | null;
  days?: number;
  budget?: string | null;
  preferences?: string[];
  limit?: number;
  traceId?: string;
};

type PlanSyncResponse = {
  status?: "completed";
  result?: PlanResponseV2;
  traceId?: string;
};

export async function planFromIntentV2(
  payload: PlanPayload
): Promise<PlanSyncResponse | AsyncAcceptedResponse> {
  const response = await apiFetchWithAuth(`${API_V2_BASE}/trips/plan-from-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<PlanSyncResponse | AsyncAcceptedResponse>(response);
}

export async function getPlanJobV2(jobId: string): Promise<JobStateV2> {
  const response = await apiFetchWithAuth(`${API_V2_BASE}/trips/plan-jobs/${encodeURIComponent(jobId)}`, {
    method: "GET"
  });
  return parseJsonResponse<JobStateV2>(response);
}

export function buildJobEventStreamUrl(jobId: string, kind?: "recommend" | "plan"): string {
  const token = getAccessToken();
  const url = new URL(`${API_V2_BASE}/jobs/${encodeURIComponent(jobId)}/events`);
  if (token) {
    url.searchParams.set("accessToken", token);
  }
  if (kind) {
    url.searchParams.set("kind", kind);
  }
  return url.toString();
}

export function buildJobWebSocketUrl(jobId: string, kind?: "recommend" | "plan"): string {
  const token = getAccessToken();
  const wsBase = API_BASE_URL.replace(/^http/i, "ws");
  const url = new URL(`${wsBase}/ws`);
  if (token) {
    url.searchParams.set("token", token);
  }
  url.searchParams.set("jobId", jobId);
  if (kind) {
    url.searchParams.set("kind", kind);
  }
  return url.toString();
}
