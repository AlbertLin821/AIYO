import type { RecommendedVideo } from "@/types/planner";

/**
 * Keep only items that can be played in the YouTube embed, and fill thumbnail URL.
 */
export function normalizeRecommendedVideos(list: unknown): RecommendedVideo[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out: RecommendedVideo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const v = item as RecommendedVideo;
    const yt = typeof v.youtube_id === "string" ? v.youtube_id.trim() : "";
    if (!yt) {
      continue;
    }
    const thumb =
      (typeof v.thumbnail_url === "string" && v.thumbnail_url.trim() !== ""
        ? v.thumbnail_url.trim()
        : `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`) || "";
    out.push({
      ...v,
      youtube_id: yt,
      thumbnail_url: thumb,
    });
  }
  return out;
}
