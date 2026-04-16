"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, apiFetchWithAuth } from "@/lib/api";
import {
  buildJobEventStreamUrl,
  buildJobWebSocketUrl,
  getPlanJobV2,
  getRecommendJobV2,
  parseVoiceIntentV2,
  planFromIntentV2,
  recommendVideosV2,
  type PlanResponseV2,
  type RenderableItemV2,
  type VoiceIntentV2
} from "@/lib/v2";

type JobKind = "recommend" | "plan";

type JobPanelState = {
  kind: JobKind;
  jobId: string;
  status: string;
};

type SpeechRecognitionEventLike = Event & {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const EMPTY_INTENT: VoiceIntentV2 = {
  destination: null,
  days: 3,
  budget: null,
  preferences: [],
  traceId: ""
};

function isAsyncAccepted(value: unknown): value is { jobId: string; pollAfterMs?: number; traceId?: string } {
  return Boolean(value && typeof value === "object" && "jobId" in value);
}

function isCompletedResponse<T>(value: unknown): value is { status?: "completed"; result?: T; traceId?: string } {
  return Boolean(value && typeof value === "object" && "result" in value);
}

function secToTime(sec: number | null): string {
  if (sec === null || sec === undefined || sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatStatsDate(raw: string | null | undefined): string {
  if (!raw) return "N/A";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString();
}

type RealtimePayload = {
  status?: string;
  result?: unknown;
  traceId?: string;
};

export default function V2Page() {
  const [voiceText, setVoiceText] = useState("");
  const [intent, setIntent] = useState<VoiceIntentV2>(EMPTY_INTENT);
  const [traceId, setTraceId] = useState("");
  const [recommendations, setRecommendations] = useState<RenderableItemV2[]>([]);
  const [planResult, setPlanResult] = useState<PlanResponseV2 | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobPanelState | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [loadingRecommend, setLoadingRecommend] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(Boolean(ctor));
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (websocketRef.current) {
        websocketRef.current.close();
        websocketRef.current = null;
      }
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        // noop
      }
    };
  }, []);

  const selectedRecommendation = useMemo(() => {
    if (!selectedSegmentId) return recommendations[0] || null;
    return recommendations.find((item) => item.segmentId === selectedSegmentId) || recommendations[0] || null;
  }, [recommendations, selectedSegmentId]);

  const mapUrl = useMemo(() => {
    if (!selectedRecommendation || selectedRecommendation.lat === null || selectedRecommendation.lng === null) {
      return "";
    }
    return `https://www.google.com/maps?q=${selectedRecommendation.lat},${selectedRecommendation.lng}&z=14&output=embed`;
  }, [selectedRecommendation]);

  function stopRealtimeTrackers() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function applyRecommendResult(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const result = payload as { items?: RenderableItemV2[]; traceId?: string };
    if (Array.isArray(result.items)) {
      setRecommendations(result.items);
      if (result.items[0]?.segmentId) {
        setSelectedSegmentId(result.items[0].segmentId);
      }
    }
    if (typeof result.traceId === "string" && result.traceId) {
      setTraceId(result.traceId);
    }
  }

  function applyPlanResult(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const result = payload as PlanResponseV2;
    setPlanResult(result);
    if (Array.isArray(result.recommendations)) {
      setRecommendations(result.recommendations);
      if (result.recommendations[0]?.segmentId) {
        setSelectedSegmentId(result.recommendations[0].segmentId);
      }
    }
    if (typeof result.traceId === "string" && result.traceId) {
      setTraceId(result.traceId);
    }
  }

  function applyJobCompletion(kind: JobKind, payload: RealtimePayload) {
    if (kind === "recommend") {
      applyRecommendResult(payload.result);
      setLoadingRecommend(false);
    } else {
      applyPlanResult(payload.result);
      setLoadingPlan(false);
    }
  }

  async function pollJobUntilDone(jobId: string, kind: JobKind, pollAfterMs = 1200) {
    try {
      const status = kind === "recommend" ? await getRecommendJobV2(jobId) : await getPlanJobV2(jobId);
      setJobState({ kind, jobId, status: status.status });
      if (status.status === "completed") {
        stopRealtimeTrackers();
        applyJobCompletion(kind, {
          status: status.status,
          result: status.result,
          traceId: status.traceId
        });
        return;
      }
      if (status.status === "failed") {
        stopRealtimeTrackers();
        setErrorText("The background job failed. Please try again.");
        setLoadingRecommend(false);
        setLoadingPlan(false);
        return;
      }
      pollTimerRef.current = window.setTimeout(() => {
        void pollJobUntilDone(jobId, kind, pollAfterMs);
      }, Math.max(500, pollAfterMs));
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Unable to read job status.");
      setLoadingRecommend(false);
      setLoadingPlan(false);
    }
  }

  function subscribeJobViaSse(jobId: string, kind: JobKind, pollAfterMs = 1200) {
    stopRealtimeTrackers();
    const url = buildJobEventStreamUrl(jobId, kind);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setJobState({ kind, jobId, status: "pending" });

    es.addEventListener("status", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as RealtimePayload;
        const status = String(data.status || "pending");
        setJobState({ kind, jobId, status });
        if (status === "completed") {
          stopRealtimeTrackers();
          applyJobCompletion(kind, data);
        }
        if (status === "failed") {
          stopRealtimeTrackers();
          setErrorText("The background job failed. Please try again.");
          setLoadingRecommend(false);
          setLoadingPlan(false);
        }
      } catch {
        // Ignore malformed chunks.
      }
    });

    es.onerror = () => {
      stopRealtimeTrackers();
      void pollJobUntilDone(jobId, kind, pollAfterMs);
    };
  }

  function subscribeJobRealtime(jobId: string, kind: JobKind, pollAfterMs = 1200) {
    stopRealtimeTrackers();
    setJobState({ kind, jobId, status: "pending" });

    if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
      subscribeJobViaSse(jobId, kind, pollAfterMs);
      return;
    }

    const wsUrl = buildJobWebSocketUrl(jobId, kind);
    let terminal = false;
    let fallbackStarted = false;

    const startFallback = () => {
      if (terminal || fallbackStarted) return;
      fallbackStarted = true;
      subscribeJobViaSse(jobId, kind, pollAfterMs);
    };

    try {
      const ws = new WebSocket(wsUrl);
      websocketRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe_job", jobId, kind }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String((event as MessageEvent).data || "")) as {
            type?: string;
            payload?: RealtimePayload;
          };
          if (data.type !== "job_status" && data.type !== "job_done") {
            return;
          }
          const payload = data.payload || {};
          const status = String(payload.status || "pending");
          setJobState({ kind, jobId, status });
          if (status === "completed") {
            terminal = true;
            stopRealtimeTrackers();
            applyJobCompletion(kind, payload);
          }
          if (status === "failed") {
            terminal = true;
            stopRealtimeTrackers();
            setErrorText("The background job failed. Please try again.");
            setLoadingRecommend(false);
            setLoadingPlan(false);
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      ws.onerror = () => {
        startFallback();
      };
      ws.onclose = () => {
        startFallback();
      };
    } catch {
      startFallback();
    }
  }

  function buildBasePayload() {
    return {
      query: voiceText.trim(),
      destination: intent.destination,
      days: intent.days || 3,
      budget: intent.budget,
      preferences: intent.preferences || [],
      traceId: traceId || intent.traceId || undefined
    };
  }

  async function onParseIntent() {
    const text = voiceText.trim();
    if (!text) {
      setErrorText("Please enter a request first.");
      return;
    }
    setErrorText(null);
    setSaveMessage(null);
    setLoadingIntent(true);
    try {
      const parsed = await parseVoiceIntentV2(text);
      setIntent(parsed);
      setTraceId(parsed.traceId);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to parse voice intent.");
    } finally {
      setLoadingIntent(false);
    }
  }

  async function onRecommend() {
    setErrorText(null);
    setSaveMessage(null);
    setLoadingRecommend(true);
    setPlanResult(null);
    try {
      const response = await recommendVideosV2({ ...buildBasePayload(), limit: 8 });
      if (isAsyncAccepted(response)) {
        setTraceId(response.traceId || traceId);
        subscribeJobRealtime(response.jobId, "recommend", response.pollAfterMs || 1200);
        return;
      }
      if (isCompletedResponse(response)) {
        applyRecommendResult(response.result);
      }
      setLoadingRecommend(false);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to recommend videos.");
      setLoadingRecommend(false);
    }
  }

  async function onPlan() {
    setErrorText(null);
    setSaveMessage(null);
    setLoadingPlan(true);
    try {
      const response = await planFromIntentV2({ ...buildBasePayload(), limit: 16 });
      if (isAsyncAccepted(response)) {
        setTraceId(response.traceId || traceId);
        subscribeJobRealtime(response.jobId, "plan", response.pollAfterMs || 1200);
        return;
      }
      if (isCompletedResponse(response)) {
        applyPlanResult(response.result);
      }
      setLoadingPlan(false);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to generate a trip plan.");
      setLoadingPlan(false);
    }
  }

  async function onSavePlan() {
    if (!planResult) {
      setErrorText("No plan available to save.");
      return;
    }
    setErrorText(null);
    setSaveMessage(null);
    setSavingPlan(true);
    try {
      const daysPayload = (planResult.plan.days || []).map((day) => ({
        day_number: Number(day.dayNumber) || 1,
        date_label: null,
        slots: (day.stops || []).map((stop, index) => ({
          place_name: String(stop.placeName || "Unnamed stop"),
          place_id: null,
          segment_id: null,
          slot_order: index + 1,
          time_range_start: stop.timeStart || null,
          time_range_end: stop.timeEnd || null
        }))
      }));
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${intent.destination || "AIYO"} trip plan`,
          daysCount: daysPayload.length || intent.days || 1,
          status: "draft",
          days: daysPayload
        })
      });
      const data = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || `save failed (${response.status})`);
      }
      setSaveMessage(`Plan saved successfully (itinerary #${data.id ?? "N/A"}).`);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to save plan.");
    } finally {
      setSavingPlan(false);
    }
  }

  function startVoiceRecognition() {
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!ctor) return;
    const recognition = new ctor();
    recognition.lang = "zh-TW";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) {
        setVoiceText((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => {
      setRecording(false);
    };
    recognition.onend = () => {
      setRecording(false);
    };
    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }

  return (
    <main className="min-h-screen bg-[#f4f7f3] text-slate-900">
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 md:px-6">
        <div className="rounded-3xl border border-[#d5dfd2] bg-gradient-to-br from-[#e7f0e4] via-[#f4f7f3] to-[#e8ecef] p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#5d7356]">AIYO V2</p>
              <h1 className="text-2xl font-bold md:text-4xl">Voice-first map planning with segment-based recommendations</h1>
              <p className="text-sm text-slate-600 md:text-base">
                Uses strict V2 contracts:
                <code> internalPlaceId / googlePlaceId / segmentId </code>
                with sync/async dual-path and traceable jobs.
              </p>
            </div>
            <div className="rounded-2xl border border-[#ced9ca] bg-white/80 px-4 py-3 text-sm backdrop-blur">
              <p className="font-semibold">Trace ID</p>
              <p className="font-mono text-xs text-slate-700">{traceId || "not assigned yet"}</p>
              <p className="mt-2 text-xs text-slate-500">
                Legacy view:
                {" "}
                <Link href="/legacy" className="underline">
                  /legacy
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 pb-10 md:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">1. Parse voice intent</h2>
            <p className="mt-1 text-sm text-slate-600">
              Parse destination, days, budget, and preferences from your text or voice input.
            </p>
            <textarea
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
              placeholder="Example: Tokyo for 4 days, budget 30000, I like night views and food"
              className="mt-3 h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onParseIntent}
                disabled={loadingIntent}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {loadingIntent ? "Parsing..." : "Parse intent"}
              </button>
              {speechSupported && (
                <button
                  type="button"
                  onClick={startVoiceRecognition}
                  disabled={recording}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  {recording ? "Listening..." : "Voice input"}
                </button>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Destination</p>
                <p className="font-medium">{intent.destination || "Not set"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Days</p>
                <p className="font-medium">{intent.days}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Budget</p>
                <p className="font-medium">{intent.budget || "Not set"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Preferences</p>
                <p className="font-medium">{intent.preferences.join(", ") || "Not set"}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRecommend}
                disabled={loadingRecommend}
                className="rounded-full bg-[#1b4d3e] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {loadingRecommend ? "Recommending..." : "2. Recommend segments"}
              </button>
              <button
                type="button"
                onClick={onPlan}
                disabled={loadingPlan}
                className="rounded-full bg-[#a35a2f] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {loadingPlan ? "Planning..." : "3. Generate plan"}
              </button>
            </div>
            {jobState && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Background job: {jobState.kind} / {jobState.jobId} / {jobState.status}
              </div>
            )}
            <div className="mt-4 space-y-2">
              {recommendations.map((item) => (
                <button
                  key={`${item.segmentId || "s"}-${item.internalPlaceId || "p"}`}
                  type="button"
                  onClick={() => setSelectedSegmentId(item.segmentId)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    item.segmentId === selectedSegmentId ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.placeName || item.videoTitle || "Untitled segment"}</p>
                    <p className="text-xs text-slate-500">
                      {secToTime(item.startSec)} - {secToTime(item.endSec)}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span>segmentId: {item.segmentId || "N/A"}</span>
                    <span>internalPlaceId: {item.internalPlaceId || "N/A"}</span>
                    <span>googlePlaceId: {item.googlePlaceId || "N/A"}</span>
                    <span>geocode: {item.geocodeStatus || "pending"}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">
                      statsUpdatedAt: {formatStatsDate(item.statsUpdatedAt)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">
                      statsStale: {String(item.statsStale)}
                    </span>
                    {item.reason.map((r) => (
                      <span key={r} className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                        {r}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
              {recommendations.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No recommendation yet. Parse an intent and run recommendation first.
                </p>
              )}
            </div>
          </div>

          {planResult && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Trip plan result</h2>
              <p className="mt-1 text-sm text-slate-600">
                feasible: {String(planResult.plan.feasible)} / warnings: {(planResult.plan.warnings || []).join(", ") || "none"}
              </p>
              <div className="mt-4 space-y-4">
                {planResult.plan.days.map((day) => (
                  <div key={`day-${day.dayNumber}`} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-medium">Day {day.dayNumber}</p>
                    {(day.warnings || []).length > 0 && (
                      <p className="mt-1 text-xs text-amber-700">{day.warnings?.join(", ")}</p>
                    )}
                    <div className="mt-2 space-y-2">
                      {day.stops.map((stop) => (
                        <div
                          key={`${stop.segmentId || "seg"}-${stop.internalPlaceId || "pid"}-${stop.timeStart || "t"}`}
                          className="rounded-lg bg-slate-50 px-3 py-2 text-sm"
                        >
                          <p className="font-medium">{stop.placeName || "Unnamed stop"}</p>
                          <p className="text-xs text-slate-600">
                            {stop.timeStart || "--:--"} - {stop.timeEnd || "--:--"} / segmentId {stop.segmentId || "N/A"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSavePlan}
                  disabled={savingPlan}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {savingPlan ? "Saving..." : "4. Save plan"}
                </button>
                {saveMessage && <p className="text-sm text-emerald-700">{saveMessage}</p>}
              </div>
              {(planResult.plan.unmappedSegments || []).length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Unmapped segments require manual confirmation:
                  {" "}
                  {planResult.plan.unmappedSegments?.length}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Map linkage</h2>
            <p className="mt-1 text-sm text-slate-600">
              Segments with <code>geocodeStatus=failed</code> stay visible in cards and timeline, but do not render a marker.
            </p>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {mapUrl ? (
                <iframe
                  title="segment-map"
                  src={mapUrl}
                  className="h-[340px] w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-[340px] items-center justify-center text-sm text-slate-500">
                  Select a recommendation with coordinates to preview the map marker.
                </div>
              )}
            </div>
          </div>

          {errorText && (
            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              {errorText}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">V1 / V2 switch</p>
            <p className="mt-1">
              V2 lives under <code>/v2</code>. In Phase C, root routes move to V2 and V1 stays read-only at
              {" "}
              <code>/legacy</code>
              {" "}
              for two weeks.
            </p>
            <div className="mt-3 flex gap-2">
              <Link className="rounded-full border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50" href="/legacy">
                Open /legacy
              </Link>
              <Link className="rounded-full border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50" href="/home">
                Open /home
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
