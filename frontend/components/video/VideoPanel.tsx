"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Play, X, MapPin, Search } from "lucide-react";
import { apiFetchWithAuth } from "@/lib/api";
import type { FullSegment, RecommendedVideo } from "@/types/planner";

const GENERIC_REASON_PHRASES = [
  "根據你的問題即時搜尋",
  "與你的搜尋主題相關",
];

function getSubstantiveReasons(reasons: string[] | undefined): string[] {
  if (!reasons || reasons.length === 0) return [];
  return reasons.filter(
    (r) => r.trim() && !GENERIC_REASON_PHRASES.some((g) => r.trim() === g || r.includes(g))
  );
}

function formatDuration(sec: number | undefined): string {
  if (!sec || sec <= 0) return "";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagToneClass(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  if (normalized.includes("景點") || normalized.includes("地標") || normalized.includes("古蹟")) {
    return "segment-tag--spot";
  }
  if (normalized.includes("美食") || normalized.includes("餐廳") || normalized.includes("小吃")) {
    return "segment-tag--food";
  }
  if (normalized.includes("風景") || normalized.includes("自然") || normalized.includes("海景")) {
    return "segment-tag--view";
  }
  return "segment-tag--default";
}

function toArrayTags(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const tags = raw.map((item) => String(item || "").trim()).filter(Boolean);
    return tags.length > 0 ? tags : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  return null;
}

interface VideoPanelProps {
  videos: RecommendedVideo[];
  onPlayVideo: (video: RecommendedVideo, startSec?: number) => void;
}

export function VideoPanel({ videos, onPlayVideo }: VideoPanelProps) {
  if (videos.length === 0) {
    return (
      <div className="rounded-card border border-border p-4 text-center">
        <p className="text-sm text-muted">傳送訊息後即可獲得相關旅遊影片推薦。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary">推薦旅遊影片</h3>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {videos.map((video, vidx) => {
          const thumbUrl = video.thumbnail_url || (video.youtube_id ? `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg` : "");
          const reasons = getSubstantiveReasons(video.recommendation_reasons);
          const durationText = formatDuration(video.duration);
          return (
          <button
            key={`${video.youtube_id || "v"}-${vidx}`}
            className="w-[260px] shrink-0 snap-start rounded-card border border-border bg-surface overflow-hidden text-left hover:shadow-card-hover transition-shadow group"
            onClick={() => onPlayVideo(video, video.segments?.[0]?.start_sec ?? 0)}
          >
            {thumbUrl ? (
              <div className="relative aspect-video overflow-hidden bg-surface-muted">
                <Image
                  src={thumbUrl}
                  alt={video.title}
                  fill
                  className="object-cover"
                  sizes="260px"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
                    <Play size={22} className="text-primary ml-0.5" />
                  </div>
                </div>
                {durationText && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {durationText}
                  </span>
                )}
              </div>
            ) : (
              <div className="relative aspect-video flex items-center justify-center bg-surface-muted">
                <Play size={32} className="text-muted" />
              </div>
            )}
            <div className="p-3">
              <p className="text-sm font-medium text-primary line-clamp-2">{video.title}</p>
              {(video.city || video.channel) && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {video.city && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary/80">
                      <MapPin size={10} />
                      {video.city}
                    </span>
                  )}
                  {video.channel && (
                    <span className="truncate text-xs text-muted">
                      {video.channel}
                    </span>
                  )}
                </div>
              )}
              {reasons.length > 0 && (
                <p className="mt-1.5 text-xs text-muted/80 line-clamp-2">
                  {reasons[0]}
                </p>
              )}
              {!reasons.length && video.summary && (
                <p className="mt-1 text-xs text-muted line-clamp-2">{video.summary}</p>
              )}
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}

interface VideoPlayerModalProps {
  video: RecommendedVideo;
  startSec: number;
  onClose: () => void;
  onJumpToTime: (sec: number) => void;
  /** 以地名／標籤嘗試在地圖上搜尋並聚焦（由外層實作） */
  onFocusPlaceByName?: (name: string) => void;
}

export function VideoPlayerModal({
  video,
  startSec,
  onClose,
  onJumpToTime,
  onFocusPlaceByName,
}: VideoPlayerModalProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [fullSegments, setFullSegments] = useState<FullSegment[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [aiOutlineSummary, setAiOutlineSummary] = useState<string | null>(null);
  const [aiOutlineSegments, setAiOutlineSegments] = useState<FullSegment[]>([]);
  const [aiOutlineLoading, setAiOutlineLoading] = useState(false);
  const [aiOutlineNotice, setAiOutlineNotice] = useState<string | null>(null);
  const aiOutlineRequestedRef = useRef(false);
  const yt = typeof video.youtube_id === "string" ? video.youtube_id.trim() : "";
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const fallbackSegments = useMemo<FullSegment[]>(() => {
    return (video.segments || []).map((seg, index) => ({
      id: seg.segment_id || index + 1,
      video_id: video.video_id,
      start_sec: seg.start_sec ?? 0,
      end_sec: seg.end_sec ?? seg.start_sec ?? 0,
      summary: seg.summary || "",
      tags: toArrayTags(seg.tags),
      city: seg.city || video.city || null,
      created_at: "",
    }));
  }, [video]);

  useEffect(() => {
    setIframeLoaded(false);
  }, [yt, startSec]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    let active = true;
    setSearchQuery("");
    setDebouncedQuery("");
    setFullSegments([]);
    setSegmentsLoading(true);
    const fallback = fallbackSegments;
    void (async () => {
      try {
        const normalizeList = (rawList: unknown): FullSegment[] => {
          const list = Array.isArray(rawList) ? rawList : [];
          return list.map((item, index) => {
            const raw = (item || {}) as Record<string, unknown>;
            return {
              id: Number(raw.id) || index + 1,
              video_id: Number(raw.video_id) || video.video_id,
              start_sec: Number(raw.start_sec) || 0,
              end_sec: Number(raw.end_sec) || 0,
              summary: String(raw.summary || ""),
              tags: toArrayTags(raw.tags),
              city: typeof raw.city === "string" ? raw.city : null,
              created_at: typeof raw.created_at === "string" ? raw.created_at : "",
            };
          });
        };

        let response: Response;
        if (yt) {
          response = await apiFetchWithAuth(
            `${apiBaseUrl}/api/videos/by-youtube/${encodeURIComponent(yt)}/segments`,
            { method: "GET" }
          );
          if (!response.ok && video.video_id) {
            response = await apiFetchWithAuth(`${apiBaseUrl}/api/videos/${video.video_id}/segments`, {
              method: "GET",
            });
          }
        } else {
          response = await apiFetchWithAuth(`${apiBaseUrl}/api/videos/${video.video_id}/segments`, {
            method: "GET",
          });
        }
        if (!response.ok) {
          throw new Error(`segments fetch failed: ${response.status}`);
        }
        const data = (await response.json().catch(() => [])) as unknown;
        const normalized = normalizeList(data);
        if (!active) {
          return;
        }
        setFullSegments(normalized.length > 0 ? normalized : fallback);
      } catch {
        if (!active) {
          return;
        }
        setFullSegments(fallback);
      } finally {
        if (active) {
          setSegmentsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, video.video_id, yt, fallbackSegments]);

  useEffect(() => {
    aiOutlineRequestedRef.current = false;
    setAiOutlineSummary(null);
    setAiOutlineSegments([]);
    setAiOutlineNotice(null);
    setAiOutlineLoading(false);
  }, [video.video_id]);

  useEffect(() => {
    if (segmentsLoading) {
      return;
    }
    const hadSummaryAtRequest = Boolean(video.summary?.trim());
    const hadSegmentsAtRequest = fullSegments.length > 0;
    if (hadSummaryAtRequest && hadSegmentsAtRequest) {
      return;
    }
    if (aiOutlineRequestedRef.current) {
      return;
    }
    aiOutlineRequestedRef.current = true;
    let active = true;
    setAiOutlineLoading(true);
    setAiOutlineNotice(null);
    void (async () => {
      const applyOutlinePayload = (raw: Record<string, unknown>) => {
        const overall = typeof raw.overall_summary === "string" ? raw.overall_summary.trim() : "";
        if (overall && !hadSummaryAtRequest) {
          setAiOutlineSummary(overall);
        }
        const segs = Array.isArray(raw.segments) ? raw.segments : [];
        const normalized: FullSegment[] = segs.map((item, index) => {
          const rec = (item || {}) as Record<string, unknown>;
          return {
            id: Number(rec.id) || index + 1,
            video_id: video.video_id,
            start_sec: Number(rec.start_sec) || 0,
            end_sec: Number(rec.end_sec) || 0,
            summary: String(rec.summary || ""),
            tags: toArrayTags(rec.tags),
            city: typeof rec.city === "string" ? rec.city : null,
            created_at: typeof rec.created_at === "string" ? rec.created_at : "",
          };
        });
        if (normalized.length > 0 && !hadSegmentsAtRequest) {
          setAiOutlineSegments(normalized);
        }
      };

      try {
        let response: Response;
        if (yt) {
          response = await apiFetchWithAuth(
            `${apiBaseUrl}/api/videos/by-youtube/${encodeURIComponent(yt)}/ai-outline`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }
          );
          if (!response.ok && video.video_id) {
            response = await apiFetchWithAuth(`${apiBaseUrl}/api/videos/${video.video_id}/ai-outline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
          }
        } else {
          response = await apiFetchWithAuth(`${apiBaseUrl}/api/videos/${video.video_id}/ai-outline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        }
        if (!response.ok && yt) {
          response = await apiFetchWithAuth(`${apiBaseUrl}/api/videos/preview-ai-outline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: video.title,
              city: video.city || "",
              description: (video.summary || "").trim(),
              youtube_id: yt,
            }),
          });
        }
        if (!response.ok) {
          const note =
            response.status === 429
              ? "摘要產生過於頻繁，請稍後再試。"
              : "無法自動產生摘要。";
          if (active) {
            setAiOutlineNotice(note);
          }
          return;
        }
        const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!active || !raw) {
          return;
        }
        applyOutlinePayload(raw);
      } catch {
        if (active) {
          setAiOutlineNotice("無法自動產生摘要。");
        }
      } finally {
        if (active) {
          setAiOutlineLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [segmentsLoading, fullSegments.length, video.summary, video.video_id, video.title, video.city, yt, apiBaseUrl]);

  const segmentsForList = useMemo(() => {
    return fullSegments.length > 0 ? fullSegments : aiOutlineSegments;
  }, [fullSegments, aiOutlineSegments]);

  const filteredSegments = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return segmentsForList;
    }
    const keyword = debouncedQuery.trim().toLowerCase();
    return segmentsForList.filter((seg) => {
      const summary = (seg.summary || "").toLowerCase();
      const hasSummary = summary.includes(keyword);
      const hasTags = Array.isArray(seg.tags) && seg.tags.some((tag) => tag.toLowerCase().includes(keyword));
      return hasSummary || hasTags;
    });
  }, [segmentsForList, debouncedQuery]);

  const highlightKeyword = debouncedQuery.trim();

  function renderHighlightedText(text: string, keyword: string) {
    if (!keyword) {
      return text;
    }
    const source = text || "";
    const pattern = new RegExp(`(${escapeRegex(keyword)})`, "ig");
    const parts = source.split(pattern);
    if (parts.length <= 1) {
      return source;
    }
    return parts.map((part, index) => {
      const isMatch = part.toLowerCase() === keyword.toLowerCase();
      if (!isMatch) {
        return <span key={`t-${index}`}>{part}</span>;
      }
      return (
        <mark key={`m-${index}`} className="segment-highlight">
          {part}
        </mark>
      );
    });
  }

  const hasSegmentData = segmentsForList.length > 0;
  const showOutlineSection = hasSegmentData || segmentsLoading || aiOutlineLoading;

  function formatSeconds(sec: number): string {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  if (!yt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-modal animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-medium text-primary">無法播放此影片</p>
          <p className="mt-2 text-xs text-muted">缺少有效的 YouTube 影片 ID。</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-lg border border-border px-4 py-2 text-sm text-primary hover:bg-surface-muted"
          >
            關閉
          </button>
        </div>
      </div>
    );
  }

  const embedSrc = `https://www.youtube.com/embed/${yt}?start=${Math.max(0, Math.floor(startSec))}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-card border border-border/60 bg-surface p-5 shadow-modal animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-semibold text-primary line-clamp-2 pr-2">{video.title}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
            aria-label="關閉"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-surface-muted">
          {!iframeLoaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-muted" aria-busy="true">
              <span className="h-8 w-8 animate-pulse rounded-full bg-primary/20" />
              <span className="text-xs text-muted">載入播放器…</span>
            </div>
          )}
          <iframe
            key={`${yt}-${startSec}`}
            title={`player-${video.video_id}-${yt}`}
            className="relative z-[1] h-full w-full"
            src={embedSrc}
            onLoad={() => setIframeLoaded(true)}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="mt-4 rounded-lg border border-border bg-surface-muted/40 p-3">
          <p className="mb-1 text-sm font-medium text-primary">影片摘要</p>
          <p className="text-xs leading-relaxed text-muted">
            {video.summary?.trim()
              ? video.summary
              : aiOutlineSummary
                ? aiOutlineSummary
                : aiOutlineLoading
                  ? "正在產生摘要…"
                  : aiOutlineNotice
                    ? aiOutlineNotice
                    : "尚無摘要。若資料庫尚無片段，系統會嘗試自動產生摘要。"}
          </p>
        </div>

        {showOutlineSection && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-primary">影片大綱</p>
              {debouncedQuery.trim() && !segmentsLoading && !aiOutlineLoading && (
                <span className="text-xs text-muted">找到 {filteredSegments.length} 個相關片段</span>
              )}
            </div>

            <div className="video-search-input">
              <Search size={14} className="text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜尋景點、美食、風景或關鍵字"
                className="video-search-input-field"
              />
            </div>

            <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-border p-2">
              {segmentsLoading || (aiOutlineLoading && !hasSegmentData) ? (
                <div className="space-y-2 p-1" aria-busy="true">
                  <div className="h-14 animate-pulse rounded-md bg-surface-muted" />
                  <div className="h-14 animate-pulse rounded-md bg-surface-muted" />
                  <div className="h-14 animate-pulse rounded-md bg-surface-muted" />
                </div>
              ) : !hasSegmentData ? (
                <p className="p-3 text-xs text-muted">
                  {yt
                    ? "資料庫中尚無此影片的分段時間軸與摘要。若系統尚未索引此片，請稍後再試；有時僅能以推薦回傳的片段為準。"
                    : "尚無片段與大綱資料。"}
                </p>
              ) : filteredSegments.length === 0 ? (
                <p className="p-3 text-xs text-muted">沒有符合關鍵字的片段，請嘗試其他字詞。</p>
              ) : (
                <div className="space-y-2">
                  {filteredSegments.map((seg) => {
                    const summaryText = seg.summary || "";
                    const summaryMatched = highlightKeyword
                      ? summaryText.toLowerCase().includes(highlightKeyword.toLowerCase())
                      : false;
                    const matchedTags = Array.isArray(seg.tags)
                      ? seg.tags.filter((tag) => highlightKeyword && tag.toLowerCase().includes(highlightKeyword.toLowerCase()))
                      : [];
                    const matchedByTag = matchedTags.length > 0;
                    const matchSourceLabel = summaryMatched && matchedByTag
                      ? "匹配來源：摘要 + 標籤"
                      : summaryMatched
                        ? "匹配來源：摘要"
                        : matchedByTag
                          ? "匹配來源：標籤"
                          : "";
                    return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => onJumpToTime(seg.start_sec)}
                      className="segment-card"
                    >
                      <div className="segment-card-row">
                        <span className="segment-time-badge">
                          {formatSeconds(seg.start_sec)} - {formatSeconds(seg.end_sec)}
                        </span>
                        {seg.city &&
                          (onFocusPlaceByName ? (
                            <button
                              type="button"
                              className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[11px] text-primary hover:bg-surface-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                onFocusPlaceByName(seg.city as string);
                              }}
                            >
                              {seg.city}
                            </button>
                          ) : (
                            <span className="rounded-full border border-border/40 bg-surface-muted/50 px-2 py-0.5 text-[11px] text-muted">
                              {seg.city}
                            </span>
                          ))}
                        {Array.isArray(seg.tags) && seg.tags.length > 0 && (
                          <span className="segment-tag-wrap">
                            {seg.tags.slice(0, 4).map((tag) => (
                              <button
                                key={`${seg.id}-${tag}`}
                                type="button"
                                className={`segment-tag ${tagToneClass(tag)}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFocusPlaceByName?.(tag);
                                }}
                              >
                                {renderHighlightedText(tag, highlightKeyword)}
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                      {matchSourceLabel && (
                        <span className="segment-match-source">{matchSourceLabel}</span>
                      )}
                      <span className="segment-summary">
                        {renderHighlightedText(summaryText || "片段摘要未提供", highlightKeyword)}
                      </span>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {(() => {
          const substantive = getSubstantiveReasons(video.recommendation_reasons);
          if (substantive.length === 0) return null;
          return (
            <div className="mt-4 rounded-lg border border-border bg-surface-muted/50 px-3 py-2">
              <p className="mb-1.5 text-xs font-medium text-primary">為什麼推薦</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs text-muted">
                {substantive.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
