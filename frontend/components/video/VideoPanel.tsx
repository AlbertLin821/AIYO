"use client";

import { Play, X } from "lucide-react";
import type { RecommendedVideo } from "@/types/planner";

interface VideoPanelProps {
  videos: RecommendedVideo[];
  onPlayVideo: (video: RecommendedVideo, startSec?: number) => void;
}

export function VideoPanel({ videos, onPlayVideo }: VideoPanelProps) {
  if (videos.length === 0) {
    return (
      <div className="rounded-card border border-border p-4 text-center">
        <p className="text-sm text-muted">Send a message to get video recommendations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary">Recommended Videos</h3>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {videos.map((video) => (
          <button
            key={video.video_id ?? video.youtube_id}
            className="w-[260px] shrink-0 snap-start rounded-card border border-border bg-surface overflow-hidden text-left hover:shadow-card-hover transition-shadow"
            onClick={() => onPlayVideo(video, video.segments?.[0]?.start_sec ?? 0)}
          >
            {video.thumbnail_url && (
              <div className="relative aspect-video overflow-hidden bg-surface-muted">
                <img
                  src={video.thumbnail_url}
                  alt={video.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
                  <Play size={32} className="text-white" />
                </div>
              </div>
            )}
            <div className="p-3">
              <p className="text-sm font-medium text-primary line-clamp-2">{video.title}</p>
              {video.city && (
                <span className="mt-1 inline-block rounded-btn bg-surface-muted px-2 py-0.5 text-xs text-muted">
                  {video.city}
                </span>
              )}
              <p className="mt-1 text-xs text-muted line-clamp-2">
                {video.summary || "No summary"}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface VideoPlayerModalProps {
  video: RecommendedVideo;
  startSec: number;
  onClose: () => void;
  onJumpToTime: (sec: number) => void;
}

export function VideoPlayerModal({ video, startSec, onClose, onJumpToTime }: VideoPlayerModalProps) {
  function formatSeconds(sec: number): string {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl bg-surface p-5 shadow-modal animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold text-primary">{video.title}</p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="aspect-video overflow-hidden rounded-xl border border-border">
          <iframe
            title={`player-${video.video_id}`}
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${video.youtube_id}?start=${startSec}&autoplay=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        {video.segments && video.segments.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-primary">Timestamps</p>
            <div className="max-h-36 overflow-auto rounded-lg border border-border p-2">
              <div className="space-y-1">
                {video.segments.map((seg) => (
                  <button
                    key={seg.segment_id}
                    onClick={() => onJumpToTime(seg.start_sec)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted transition-colors"
                  >
                    <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium">
                      {formatSeconds(seg.start_sec)}
                    </span>
                    <span className="text-xs text-muted line-clamp-1">{seg.summary || "Segment"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
