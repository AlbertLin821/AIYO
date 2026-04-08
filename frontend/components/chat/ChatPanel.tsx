"use client";

import { FormEvent as ReactFormEvent, useRef, useEffect, useState } from "react";
import Image from "next/image";
import type { ChatMessage, ToolCallSummary, RecommendedVideo } from "@/types/planner";
import { ChatMessageComponent } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { Sparkles, Play, ChevronDown, ChevronUp, Heart, MapPin, Video, Clock, Star } from "lucide-react";

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

function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function VideoThumb({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-travel-sky/25 to-primary/10" aria-hidden>
        <MapPin className="h-7 w-7 text-travel-ocean/70" />
        <span className="max-w-[100px] truncate px-1 text-center text-[10px] text-muted">{title || "影片"}</span>
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt=""
      fill
      loading="lazy"
      className="object-cover"
      sizes="200px"
      onError={() => setFailed(true)}
    />
  );
}

const suggestedPrompts = [
  { label: "東京三天兩夜", prompt: "幫我規劃東京三天兩夜的行程，預算中等" },
  { label: "台南美食之旅", prompt: "推薦台南必吃美食和景點，兩天一夜" },
  { label: "京都賞櫻攻略", prompt: "京都賞櫻最佳路線和時間建議" },
  { label: "親子旅遊推薦", prompt: "適合帶小孩的旅遊地點推薦，三天以內" },
];

type ChatModelOption = { name: string };

interface ChatPanelProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: (e: ReactFormEvent<HTMLFormElement>) => void;
  chatLoading: boolean;
  chatError: string | null;
  chatDegraded: boolean;
  toolCallSummaries: ToolCallSummary[];
  speechSupported: boolean;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  greeting?: string;
  modelOptions?: ChatModelOption[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  modelsLoading?: boolean;
  recommendedVideos?: RecommendedVideo[];
  onPlayVideo?: (video: RecommendedVideo, startSec?: number) => void;
  onLikeVideo?: (video: RecommendedVideo, liked: boolean) => void;
  onLoadMore?: (excludeYoutubeIds: string[], lastQuery: string) => Promise<RecommendedVideo[]>;
  lastRecommendationQuery?: string;
  onQuickReplyClick?: (options: string[]) => void;
}

export function ChatPanel({
  messages,
  chatInput,
  onChatInputChange,
  onSubmit,
  chatLoading,
  chatError,
  chatDegraded,
  toolCallSummaries,
  speechSupported,
  isRecording,
  onStartRecording,
  onStopRecording,
  greeting = "想去哪裡旅行？",
  modelOptions = [],
  selectedModel = "",
  onModelChange,
  modelsLoading = false,
  recommendedVideos = [],
  onPlayVideo,
  onLikeVideo,
  onLoadMore,
  lastRecommendationQuery = "",
  onQuickReplyClick,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [likedYoutubeIds, setLikedYoutubeIds] = useState<Set<string>>(new Set());
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [recommendationBlockOpen, setRecommendationBlockOpen] = useState(true);
  const loadMoreEnabled = Boolean(onLoadMore && !loadMoreLoading);
  const displayVideos = recommendedVideos;
  const showRecommendationArea = Boolean(onPlayVideo);
  const showRecommendationList = displayVideos.length > 0;
  const showRecommendationLoading = chatLoading && !showRecommendationList;
  const hasUserMessage = messages.some((m) => m.role === "user");
  const showRecommendationEmpty = !chatLoading && !showRecommendationList && hasUserMessage;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const showModelSelect = modelOptions.length > 0 && onModelChange;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showModelSelect && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2">
          <label htmlFor="chat-model-select" className="text-xs font-medium text-muted shrink-0">
            模型
          </label>
          <select
            id="chat-model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={modelsLoading}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-3 py-1.5 text-sm text-primary outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            aria-label="選擇 Ollama 模型"
          >
            {modelsLoading ? (
              <option value="">載入中...</option>
            ) : (
              modelOptions.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-5 pt-8">
            <h1 className="text-page-title text-primary">{greeting}</h1>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5">
                <Sparkles size={16} className="text-primary" />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-sm leading-relaxed text-primary font-medium">
                  嗨！我是你的 AI 旅遊助手
                </p>
                <p className="text-sm leading-relaxed text-muted">
                  告訴我你想去的地方、旅遊天數、預算，我會在幾分鐘內幫你生成專屬行程。也可以問我任何旅遊相關問題！
                </p>
              </div>
            </div>
            <div className="w-full pt-2">
              <p className="mb-3 text-xs font-medium text-muted">試試看這些：</p>
              <div className="grid grid-cols-2 gap-2">
                {suggestedPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-sm text-primary hover:bg-surface-muted hover:border-primary/30 transition-all"
                    onClick={() => {
                      onChatInputChange(item.prompt);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((message, index) => (
            <ChatMessageComponent
              key={`${message.role}-${index}`}
              message={message}
              isStreaming={chatLoading && index === messages.length - 1 && message.role === "assistant"}
              disableQuickReplies={chatLoading}
              onOptionsSubmit={onQuickReplyClick}
            />
          ))}
        </div>

        {chatDegraded && (
          <p className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent-dark">
            目前以短期記憶模式運作，長期偏好設定可能尚未完全套用。
          </p>
        )}

        {toolCallSummaries.length > 0 && (
          <div className="mt-3 rounded-lg border border-border p-3 text-xs">
            <p className="mb-2 font-medium text-primary">已使用的工具</p>
            <div className="space-y-1">
              {toolCallSummaries.map((item, index) => (
                <div key={`${item.tool ?? "tool"}-${index}`} className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1">
                  <span className="font-medium">{item.tool ?? "未知"}</span>
                  <span className={item.ok ? "text-success" : "text-danger"}>
                    {item.ok ? "成功" : "失敗"}
                  </span>
                  {item.source && <span className="text-muted">{item.source}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {chatError && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {chatError}
          </p>
        )}
      </div>

      {showRecommendationArea && (
        <div className="shrink-0 border-t border-border bg-gradient-to-b from-surface-muted/30 to-surface px-4 py-3">
          <button
            type="button"
            onClick={() => setRecommendationBlockOpen((open) => !open)}
            className="mb-2 flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-primary hover:opacity-80 transition-opacity"
            aria-expanded={recommendationBlockOpen}
            aria-label={recommendationBlockOpen ? "收合推薦影片" : "展開推薦影片"}
          >
            <span className="flex items-center gap-1.5">
              <Video size={14} className="text-primary/70" />
              相關旅遊影片
              {showRecommendationList && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {displayVideos.length}
                </span>
              )}
            </span>
            {recommendationBlockOpen ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
          </button>

          {recommendationBlockOpen && showRecommendationLoading && (
            <div className="flex items-center gap-3 py-5" aria-busy="true">
              <div className="flex gap-1">
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-primary/40" style={{ animationDelay: "0ms" }} />
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-primary/40" style={{ animationDelay: "150ms" }} />
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-primary/40" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm text-muted">正在為你挑選相關旅遊影片...</span>
            </div>
          )}

          {recommendationBlockOpen && showRecommendationList && (
            <div className="flex flex-nowrap gap-3 overflow-x-auto pb-2 scrollbar-thin" role="list">
              {displayVideos.map((video, vidx) => {
                const thumbUrl = video.thumbnail_url || (video.youtube_id ? `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg` : "");
                const cardKey = `rec-${vidx}-${video.youtube_id || `id-${video.video_id}`}-${video.title?.slice(0, 20) || "v"}`;
                const reasons = getSubstantiveReasons(video.recommendation_reasons);
                const durationText = formatDuration(video.duration);
                return (
                  <div
                    key={cardKey}
                    className="flex w-[200px] min-w-[200px] shrink-0 flex-col rounded-xl border border-border bg-surface overflow-hidden shadow-sm hover:shadow-md hover:border-primary/30 transition-all group"
                  >
                    <div className="relative">
                      <button
                        type="button"
                        className="flex flex-col text-left w-full"
                        onClick={() => onPlayVideo?.(video, video.segments?.[0]?.start_sec)}
                        aria-label={`播放：${video.title}`}
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-surface-muted">
                          <VideoThumb url={thumbUrl} title={video.title} />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                              <Play size={18} className="text-primary ml-0.5" />
                            </div>
                          </div>
                          {durationText && (
                            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {durationText}
                            </span>
                          )}
                        </div>
                        <div className="p-2.5">
                          <p className="text-xs font-medium text-primary line-clamp-2 leading-snug">{video.title}</p>
                          {(video.city || video.channel) && (
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              {video.city && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary/80">
                                  <MapPin size={9} />
                                  {video.city}
                                </span>
                              )}
                              {video.channel && (
                                <span className="truncate text-[10px] text-muted">
                                  {video.channel}
                                </span>
                              )}
                            </div>
                          )}
                          {reasons.length > 0 && (
                            <p className="mt-1.5 text-[10px] leading-snug text-muted/80 line-clamp-2">
                              {reasons[0]}
                            </p>
                          )}
                        </div>
                      </button>
                      {onLikeVideo && video.youtube_id && (
                        <button
                          type="button"
                          className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 backdrop-blur-sm transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextLiked = !likedYoutubeIds.has(video.youtube_id);
                            setLikedYoutubeIds((prev) => {
                              const next = new Set(prev);
                              if (nextLiked) next.add(video.youtube_id);
                              else next.delete(video.youtube_id);
                              return next;
                            });
                            onLikeVideo(video, nextLiked);
                          }}
                          aria-label={likedYoutubeIds.has(video.youtube_id) ? "取消收藏" : "收藏此影片"}
                        >
                          <Heart
                            size={13}
                            className={likedYoutubeIds.has(video.youtube_id) ? "fill-current text-red-400" : ""}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {recommendationBlockOpen && showRecommendationList && onLoadMore && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                disabled={!loadMoreEnabled}
                onClick={async () => {
                  if (!onLoadMore || loadMoreLoading) return;
                  setLoadMoreLoading(true);
                  try {
                    const excludeIds = displayVideos.map((v) => v.youtube_id).filter(Boolean);
                    await onLoadMore(excludeIds, lastRecommendationQuery);
                  } finally {
                    setLoadMoreLoading(false);
                  }
                }}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-medium text-primary hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadMoreLoading ? "載入更多影片中..." : "探索更多影片"}
              </button>
            </div>
          )}

          {recommendationBlockOpen && showRecommendationEmpty && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Video size={20} className="text-muted/50" />
              <p className="text-center text-sm text-muted">
                目前沒有推薦影片，試試換個問法或地點。
              </p>
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 text-center text-xs text-muted pb-1">
        AIYO can make mistakes. Check important info.
      </div>

      <div className="shrink-0">
        <ChatInput
        value={chatInput}
        onChange={onChatInputChange}
        onSubmit={onSubmit}
        loading={chatLoading}
        speechSupported={speechSupported}
        isRecording={isRecording}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
      />
      </div>
    </div>
  );
}
