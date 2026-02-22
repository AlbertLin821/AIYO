"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type TransportMode = "drive" | "transit" | "walk" | "bike";
type BudgetMode = "A" | "B" | "C";
type AiPanelMode = "A" | "B" | "C";
type MultiDayMode = "A" | "B" | "C";
type CommentMode = "A" | "B" | "C";
type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatModelOption = {
  name: string;
};

type MapSearchResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
};

type SegmentSearchItem = {
  id: number;
  video_id: number;
  start_sec: number;
  end_sec: number;
  summary?: string;
  tags?: unknown;
  city?: string | null;
  distance?: number;
};

type UserProfile = {
  display_name?: string | null;
  travel_style?: string | null;
  budget_pref?: string | null;
  pace_pref?: string | null;
  transport_pref?: string | null;
  dietary_pref?: string | null;
  preferred_cities?: string[] | null;
};

type RecommendedSegment = {
  segment_id: number;
  start_sec: number;
  end_sec: number;
  summary?: string;
};

type RecommendedVideo = {
  video_id: number;
  youtube_id: string;
  title: string;
  channel?: string;
  duration?: number;
  city?: string;
  thumbnail_url?: string;
  summary?: string;
  segments: RecommendedSegment[];
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
    google?: typeof google;
    __googleMapsScriptLoadingPromise?: Promise<typeof google>;
  }
}

type Place = {
  id: string;
  name: string;
  intro: string;
  address: string;
  phone: string;
  website: string;
  rating: number;
  hours: string;
  reasons: string[];
  notes: string[];
  stayMinutes: number;
  estimatedCost: number;
  recommended: boolean;
  x: number;
  y: number;
  lat: number;
  lng: number;
  googleComments: string[];
};

type DayPlan = {
  id: string;
  label: string;
  placeIds: string[];
};

type PlannerState = {
  days: DayPlan[];
  selectedDayId: string;
  pendingPlaceIds: string[];
  transportModes: Record<string, TransportMode>;
  budgetMode: BudgetMode;
  totalBudget: number;
  spentBudget: number;
  aiPanelMode: AiPanelMode;
  multiDayMode: MultiDayMode;
  commentMode: CommentMode;
};

const places: Place[] = [
  {
    id: "p1",
    name: "安平古堡",
    intro: "台南代表性古蹟，可快速理解安平歷史脈絡。",
    address: "台南市安平區國勝路82號",
    phone: "06-2267348",
    website: "https://www.twtainan.net/zh-tw/attractions/detail/661",
    rating: 4.3,
    hours: "08:30-17:30",
    reasons: ["歷史文化完整", "適合半日參觀", "交通節點方便"],
    notes: ["建議上午前往避開人潮", "周邊可順遊安平老街", "夏季日照強需防曬", "古蹟區階梯較多"],
    stayMinutes: 90,
    estimatedCost: 150,
    recommended: true,
    x: 24,
    y: 34,
    lat: 22.999,
    lng: 120.16,
    googleComments: ["古蹟保存良好，導覽內容完整。", "周邊小吃多，停留時間比預期長。"]
  },
  {
    id: "p2",
    name: "神農街",
    intro: "老屋與文創店家聚集，夜間燈光氣氛佳。",
    address: "台南市中西區神農街",
    phone: "06-2991111",
    website: "https://www.twtainan.net/zh-tw/attractions/detail/709",
    rating: 4.4,
    hours: "全天開放",
    reasons: ["夜間拍照效果佳", "步行友善", "可串接美食路線"],
    notes: ["傍晚後人潮較多", "建議穿好走鞋", "可預留時間逛文創店", "注意店家營業時間差異"],
    stayMinutes: 75,
    estimatedCost: 200,
    recommended: false,
    x: 50,
    y: 52,
    lat: 22.996,
    lng: 120.196,
    googleComments: ["街景很有特色，適合拍照。", "假日較擁擠，建議平日前往。"]
  },
  {
    id: "p3",
    name: "奇美博物館",
    intro: "館藏豐富，適合安排半天以上室內行程。",
    address: "台南市仁德區文華路二段66號",
    phone: "06-2660808",
    website: "https://www.chimeimuseum.org/",
    rating: 4.7,
    hours: "09:30-17:30",
    reasons: ["展覽內容多元", "雨天備案友善", "親子與朋友皆適合"],
    notes: ["建議先線上購票", "館區較大需保留移動時間", "熱門展區可能排隊", "可搭配戶外園區散步"],
    stayMinutes: 180,
    estimatedCost: 450,
    recommended: true,
    x: 70,
    y: 68,
    lat: 22.934,
    lng: 120.226,
    googleComments: ["館藏內容豐富，值得慢慢看。", "停車便利，整體體驗很不錯。"]
  }
];

const initialState: PlannerState = {
  days: [
    { id: "day1", label: "2026/02/21 (六)", placeIds: ["p1", "p2"] },
    { id: "day2", label: "2026/02/22 (日)", placeIds: ["p3"] },
    { id: "day3", label: "2026/02/23 (一)", placeIds: [] }
  ],
  selectedDayId: "day1",
  pendingPlaceIds: [],
  transportModes: {},
  budgetMode: "C",
  totalBudget: 5000,
  spentBudget: 1200,
  aiPanelMode: "C",
  multiDayMode: "B",
  commentMode: "C"
};

function deepCloneState(input: PlannerState): PlannerState {
  return JSON.parse(JSON.stringify(input)) as PlannerState;
}

function getPlaceById(placeId: string): Place | undefined {
  return places.find((item) => item.id === placeId);
}

function mapDistanceKm(from: Place, to: Place): number {
  const dx = (from.lat - to.lat) * 111;
  const dy = (from.lng - to.lng) * 101;
  return Math.max(1, Math.sqrt(dx * dx + dy * dy));
}

function estimateTransport(mode: TransportMode, distanceKm: number): { minutes: number; distance: string } {
  const speed = mode === "drive" ? 45 : mode === "transit" ? 30 : mode === "bike" ? 14 : 5;
  const minutes = Math.round((distanceKm / speed) * 60 + (mode === "transit" ? 12 : 4));
  return { minutes, distance: `${distanceKm.toFixed(1)} km` };
}

function buildNextDay(days: DayPlan[]): DayPlan {
  const maxDayIndex = days.reduce((max, day) => {
    const match = /^day(\d+)$/i.exec(day.id);
    const value = match ? Number(match[1]) : 0;
    return Math.max(max, value);
  }, 0);
  const nextDayIndex = maxDayIndex + 1;

  const lastLabel = days.at(-1)?.label ?? "";
  const dateMatch = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(lastLabel);
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];

  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return {
      id: `day${nextDayIndex}`,
      label: `${y}/${m}/${d} (${weekdayText[date.getDay()]})`,
      placeIds: []
    };
  }

  return {
    id: `day${nextDayIndex}`,
    label: `DAY ${nextDayIndex}`,
    placeIds: []
  };
}

function renumberDays(days: DayPlan[]): { days: DayPlan[]; idMap: Record<string, string> } {
  const idMap: Record<string, string> = {};
  const normalized = days.map((day, index) => {
    const nextId = `day${index + 1}`;
    idMap[day.id] = nextId;
    return { ...day, id: nextId };
  });
  return { days: normalized, idMap };
}

function remapTransportModes(
  transportModes: Record<string, TransportMode>,
  idMap: Record<string, string>
): Record<string, TransportMode> {
  const next: Record<string, TransportMode> = {};
  Object.entries(transportModes).forEach(([key, mode]) => {
    const split = key.indexOf(":");
    if (split < 0) {
      next[key] = mode;
      return;
    }
    const dayId = key.slice(0, split);
    const suffix = key.slice(split + 1);
    const mappedDayId = idMap[dayId] ?? dayId;
    next[`${mappedDayId}:${suffix}`] = mode;
  });
  return next;
}

const CHAT_MEMORY_LIMIT = 20;
const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  { role: "assistant", content: "請描述你想要的旅遊風格，我會推薦景點。" }
];
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

function loadGoogleMapsApi(): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps 僅能在瀏覽器環境使用。"));
  }
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }
  if (window.__googleMapsScriptLoadingPromise) {
    return window.__googleMapsScriptLoadingPromise;
  }
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error("缺少 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY。"));
  }

  window.__googleMapsScriptLoadingPromise = new Promise<typeof google>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }
      reject(new Error("Google Maps 載入失敗。"));
    };
    script.onerror = () => reject(new Error("Google Maps 腳本載入失敗。"));
    document.head.appendChild(script);
  });

  return window.__googleMapsScriptLoadingPromise;
}

function getAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem("aiyo_token") ?? "";
}

function buildWsUrl(token: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

function extractWsStreamTokens(chunk: string): string {
  const lines = chunk.split("\n");
  let text = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const body = line.slice(5).trim();
    if (!body) {
      continue;
    }
    try {
      const parsed = JSON.parse(body) as { token?: string };
      if (parsed.token) {
        text += parsed.token;
      }
    } catch {
      // Ignore malformed data event.
    }
  }
  return text;
}

function trimChatMessages(messages: ChatMessage[], limit: number): ChatMessage[] {
  if (messages.length <= limit) {
    return messages;
  }
  return messages.slice(messages.length - limit);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineMarkdown(input: string): string {
  return input
    .replace(/`([^`]+)`/g, "<code class=\"rounded bg-slate-100 px-1 py-0.5 font-mono text-xs\">$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      "<a href=\"$2\" target=\"_blank\" rel=\"noreferrer\" class=\"underline text-blue-700\">$1</a>"
    );
}

function markdownToSafeHtml(markdown: string): string {
  const normalized = escapeHtml(markdown.replace(/\r\n/g, "\n"));
  const codeBlocks: string[] = [];
  const withCodePlaceholder = normalized.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langText = lang ? `<div class="mb-1 text-xs text-slate-500">${lang}</div>` : "";
    const html = `<pre class="my-2 overflow-auto rounded bg-slate-900 p-2 text-slate-100"><code>${langText}${code.trim()}</code></pre>`;
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(html);
    return token;
  });

  const lines = withCodePlaceholder.split("\n");
  const parts: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      parts.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      parts.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      closeLists();
      continue;
    }
    if (text.startsWith("@@CODE_BLOCK_")) {
      closeLists();
      parts.push(text);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      parts.push(`<h${level} class="my-1 font-semibold">${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(text);
    if (ordered) {
      if (inUl) {
        parts.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        parts.push("<ol class=\"my-1 list-decimal pl-5\">");
        inOl = true;
      }
      parts.push(`<li>${formatInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(text);
    if (unordered) {
      if (inOl) {
        parts.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        parts.push("<ul class=\"my-1 list-disc pl-5\">");
        inUl = true;
      }
      parts.push(`<li>${formatInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    closeLists();
    parts.push(`<p class="my-1">${formatInlineMarkdown(text)}</p>`);
  }
  closeLists();

  let html = parts.join("");
  codeBlocks.forEach((item, index) => {
    html = html.replace(`@@CODE_BLOCK_${index}@@`, item);
  });
  return html;
}

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<PlannerState[]>([initialState]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [mapActionError, setMapActionError] = useState<string | null>(null);
  const [mapSearchResults, setMapSearchResults] = useState<MapSearchResult[]>([]);
  const [mapSearchMode, setMapSearchMode] = useState<"center" | "global">("center");
  const [mapSearchRadiusKm, setMapSearchRadiusKm] = useState(25);
  const [locatingCurrentPosition, setLocatingCurrentPosition] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dayDragIndex, setDayDragIndex] = useState<number | null>(null);
  const [dayContextMenu, setDayContextMenu] = useState<{ dayId: string; x: number; y: number } | null>(null);
  const [openMoveMenuKey, setOpenMoveMenuKey] = useState<string | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<"itinerary" | "ai">("itinerary");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState("session-anon");
  const sessionFromUrl = searchParams.get("session");
  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl.trim()) {
      setChatSessionId(sessionFromUrl.trim());
    }
  }, [sessionFromUrl]);
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [segmentCity, setSegmentCity] = useState("");
  const [segmentLimit, setSegmentLimit] = useState(8);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentMode, setSegmentMode] = useState<string>("");
  const [segmentItems, setSegmentItems] = useState<SegmentSearchItem[]>([]);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [profile, setProfile] = useState<UserProfile>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [memoryItems, setMemoryItems] = useState<Array<{ id: number; memory_text: string; memory_type: string }>>([]);
  const [recommendedVideos, setRecommendedVideos] = useState<RecommendedVideo[]>([]);
  const [playerVideo, setPlayerVideo] = useState<RecommendedVideo | null>(null);
  const [playerStartSec, setPlayerStartSec] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStreamPreview, setWsStreamPreview] = useState("");
  const [wsItineraryEvents, setWsItineraryEvents] = useState<Array<{ action: string; at: string }>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseInputRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamingViaSseRef = useRef(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const markerRefs = useRef<Map<string, google.maps.Marker>>(new Map());
  const searchResultMarkersRef = useRef<google.maps.Marker[]>([]);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);

  const state = history[historyIndex];
  const selectedDay = state.days.find((day) => day.id === state.selectedDayId) ?? state.days[0];
  const selectedPlace = places.find((item) => item.id === selectedPlaceId);

  const usedOrRecommendedIds = useMemo(() => {
    const ids = new Set<string>();
    state.days.forEach((day) => day.placeIds.forEach((id) => ids.add(id)));
    state.pendingPlaceIds.forEach((id) => ids.add(id));
    places.filter((item) => item.recommended).forEach((item) => ids.add(item.id));
    return ids;
  }, [state.days, state.pendingPlaceIds]);

  const mapPlaces = useMemo(
    () => places.filter((item) => usedOrRecommendedIds.has(item.id)),
    [usedOrRecommendedIds]
  );

  const selectedDayPlaces = selectedDay.placeIds
    .map((id) => getPlaceById(id))
    .filter((item): item is Place => Boolean(item));

  const pendingPlaces = state.pendingPlaceIds
    .map((id) => getPlaceById(id))
    .filter((item): item is Place => Boolean(item));

  const estimatedDayCost = selectedDayPlaces.reduce((sum, place) => sum + place.estimatedCost, 0);
  const enableDayHorizontalScroll = state.days.length > 5;

  function openStreetViewAt(lat: number, lng: number) {
    const map = googleMapRef.current;
    const googleApi = window.google;
    if (!map || !googleApi?.maps) {
      setMapActionError("地圖尚未就緒，請稍後再試。");
      return;
    }
    const service = streetViewServiceRef.current ?? new googleApi.maps.StreetViewService();
    streetViewServiceRef.current = service;
    const panorama = map.getStreetView();
    setMapActionError(null);
    service.getPanorama({ location: { lat, lng }, radius: 120 }, (data, status) => {
      if (status !== googleApi.maps.StreetViewStatus.OK || !data?.location?.latLng) {
        setMapActionError("此位置附近目前沒有可用街景。");
        return;
      }
      panorama.setPosition(data.location.latLng);
      panorama.setPov({ heading: 0, pitch: 0 });
      panorama.setVisible(true);
    });
  }

  function openStreetViewAtMapCenter() {
    const map = googleMapRef.current;
    const center = map?.getCenter();
    if (!center) {
      setMapActionError("目前無法取得地圖中心點。");
      return;
    }
    openStreetViewAt(center.lat(), center.lng());
  }

  function clearSearchResultMarkers() {
    searchResultMarkersRef.current.forEach((marker) => marker.setMap(null));
    searchResultMarkersRef.current = [];
  }

  function renderSearchResultsOnMap(results: MapSearchResult[], map: google.maps.Map, googleApi: typeof google) {
    clearSearchResultMarkers();
    if (results.length === 0) {
      return;
    }
    const bounds = new googleApi.maps.LatLngBounds();
    results.forEach((result, index) => {
      const marker = new googleApi.maps.Marker({
        map,
        position: { lat: result.lat, lng: result.lng },
        title: result.name,
        label: String(index + 1)
      });
      marker.addListener("click", () => {
        map.panTo({ lat: result.lat, lng: result.lng });
        map.setZoom(16);
      });
      searchResultMarkersRef.current.push(marker);
      bounds.extend({ lat: result.lat, lng: result.lng });
    });
    map.fitBounds(bounds, 80);
  }

  async function onMapSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      return;
    }
    const map = googleMapRef.current;
    const googleApi = window.google;
    if (!map || !googleApi?.maps) {
      setMapActionError("地圖尚未就緒，請稍後再試。");
      return;
    }

    const normalizedQuery = query.toLocaleLowerCase();
    const localMatches = places
      .filter(
      (place) =>
        place.name.toLocaleLowerCase().includes(normalizedQuery) ||
        place.address.toLocaleLowerCase().includes(normalizedQuery)
      )
      .slice(0, 8);
    if (localMatches.length > 0) {
      const localResults: MapSearchResult[] = localMatches.map((place) => ({
        id: place.id,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating
      }));
      setMapSearchResults(localResults);
      setMapActionError(null);
      setSelectedPlaceId(localMatches[0].id);
      renderSearchResultsOnMap(localResults, map, googleApi);
      return;
    }

    const placesService = placesServiceRef.current ?? new googleApi.maps.places.PlacesService(map);
    placesServiceRef.current = placesService;
    setMapActionError(null);
    const candidateQuery = /[台臺]灣/.test(query) ? query : `${query} 台灣`;
    const mapCenter = map.getCenter() ?? null;
    const radiusMeters = Math.max(1000, Math.min(50000, Math.round(mapSearchRadiusKm * 1000)));
    const textSearchRequest: google.maps.places.TextSearchRequest =
      mapSearchMode === "center" && mapCenter
        ? { query: candidateQuery, location: mapCenter, radius: radiusMeters }
        : { query: candidateQuery };

    const searchWithPagination = async (request: google.maps.places.TextSearchRequest) =>
      new Promise<{
        status: google.maps.places.PlacesServiceStatus;
        items: MapSearchResult[];
      }>((resolve) => {
        const merged = new Map<string, MapSearchResult>();
        const maxPages = 5;
        const maxItems = 100;
        let pages = 0;
        let resolved = false;

        const settle = (status: google.maps.places.PlacesServiceStatus) => {
          if (resolved) {
            return;
          }
          resolved = true;
          resolve({ status, items: Array.from(merged.values()).slice(0, maxItems) });
        };

        const callback = (
          results: google.maps.places.PlaceResult[] | null,
          status: google.maps.places.PlacesServiceStatus,
          pagination: google.maps.places.PlaceSearchPagination | null
        ) => {
          if (status === googleApi.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
            settle(status);
            return;
          }
          if (status === googleApi.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
            settle(status);
            return;
          }
          if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !results) {
            settle(status);
            return;
          }

          for (const item of results) {
            if (!item.geometry?.location) {
              continue;
            }
            const id = item.place_id ?? `${item.name ?? "result"}-${item.geometry.location.toUrlValue()}`;
            if (!merged.has(id)) {
              merged.set(id, {
                id,
                name: item.name ?? "未命名地點",
                address: item.formatted_address ?? item.vicinity ?? "無地址資訊",
                lat: item.geometry.location.lat(),
                lng: item.geometry.location.lng(),
                rating: item.rating
              });
            }
          }

          pages += 1;
          const canLoadNext = Boolean(pagination?.hasNextPage) && pages < maxPages && merged.size < maxItems;
          if (canLoadNext && pagination) {
            setTimeout(() => pagination.nextPage(), 1200);
            return;
          }
          settle(status);
        };

        placesService.textSearch(request, callback);
      });

    const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const dLat = (aLat - bLat) * 111;
      const dLng = (aLng - bLng) * 101;
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };

    const scoreByKeyword = (item: MapSearchResult, keywordText: string) => {
      const name = item.name.toLocaleLowerCase();
      const address = item.address.toLocaleLowerCase();
      let score = 0;
      if (name.includes(keywordText)) score += 3.2;
      if (address.includes(keywordText)) score += 1.7;
      const tokens = keywordText.split(/\s+/).filter((token) => token.length > 0);
      for (const token of tokens) {
        if (name.includes(token)) score += 0.8;
        if (address.includes(token)) score += 0.35;
      }
      return score;
    };

    const primary = await searchWithPagination(textSearchRequest);
    let status = primary.status;
    let items = primary.items;
    if (mapSearchMode === "center" && items.length < 8) {
      const globalFallback = await searchWithPagination({ query: candidateQuery });
      status = globalFallback.status === googleApi.maps.places.PlacesServiceStatus.OK ? globalFallback.status : status;
      const merged = new Map<string, MapSearchResult>();
      for (const item of items) merged.set(item.id, item);
      for (const item of globalFallback.items) {
        if (!merged.has(item.id)) {
          merged.set(item.id, item);
        }
      }
      items = Array.from(merged.values());
    }
    if (status === googleApi.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
      setMapSearchResults([]);
      clearSearchResultMarkers();
      setMapActionError("搜尋被拒絕（REQUEST_DENIED）。請確認前端金鑰已啟用 Places API。");
      return;
    }
    if (status === googleApi.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
      setMapSearchResults([]);
      clearSearchResultMarkers();
      setMapActionError("搜尋暫時超過查詢上限，請稍後再試。");
      return;
    }
    if (status !== googleApi.maps.places.PlacesServiceStatus.OK || items.length === 0) {
      setMapSearchResults([]);
      clearSearchResultMarkers();
      setMapActionError("找不到相關地點，請換一組關鍵字。");
      return;
    }

    const keyword = query.trim().toLocaleLowerCase();
    const centerLat = mapCenter?.lat() ?? null;
    const centerLng = mapCenter?.lng() ?? null;
    const ranked = [...items].sort((a, b) => {
      const aScore = scoreByKeyword(a, keyword);
      const bScore = scoreByKeyword(b, keyword);
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      if (centerLat !== null && centerLng !== null) {
        const aDist = distanceKm(a.lat, a.lng, centerLat, centerLng);
        const bDist = distanceKm(b.lat, b.lng, centerLat, centerLng);
        if (aDist !== bDist) {
          return aDist - bDist;
        }
      }
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
    const topResults = ranked.slice(0, 50);

    setSelectedPlaceId(null);
    setMapSearchResults(topResults);
    setMapActionError(null);
    renderSearchResultsOnMap(topResults, map, googleApi);
  }

  function locateCurrentPosition() {
    const map = googleMapRef.current;
    if (!map) {
      setMapActionError("地圖尚未就緒，請稍後再試。");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMapActionError("目前瀏覽器不支援定位。");
      return;
    }
    setLocatingCurrentPosition(true);
    setMapActionError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.panTo({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        map.setZoom(14);
        setLocatingCurrentPosition(false);
      },
      () => {
        setLocatingCurrentPosition(false);
        setMapActionError("無法取得目前位置，請確認定位權限已開啟。");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function focusSearchResult(result: MapSearchResult) {
    const map = googleMapRef.current;
    if (!map) {
      setMapActionError("地圖尚未就緒，請稍後再試。");
      return;
    }
    setMapActionError(null);
    setSelectedPlaceId(null);
    map.panTo({ lat: result.lat, lng: result.lng });
    map.setZoom(17);
  }

  function clearMapSearch() {
    setMapSearchResults([]);
    clearSearchResultMarkers();
    setMapActionError(null);
  }

  function onMapSearchInputChange(value: string) {
    setSearchText(value);
    if (!value.trim()) {
      clearMapSearch();
    }
  }

  function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = getAccessToken();
    return {
      ...(extra ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  useEffect(() => {
    if (!authReady) {
      return;
    }
    if (!mapContainerRef.current) {
      return;
    }
    const markers = markerRefs.current;
    let alive = true;
    void (async () => {
      try {
        setMapError(null);
        const googleApi = await loadGoogleMapsApi();
        if (!alive || !mapContainerRef.current) {
          return;
        }
        const map = new googleApi.maps.Map(mapContainerRef.current, {
          center: { lat: 23.000, lng: 120.200 },
          zoom: 10,
          mapTypeId: "roadmap",
          streetViewControl: true,
          fullscreenControl: false
        });
        googleMapRef.current = map;
        mapClickListenerRef.current = map.addListener("click", () => setSelectedPlaceId(null));
        setMapReady(true);
      } catch (error) {
        if (!alive) {
          return;
        }
        const text = error instanceof Error ? error.message : "Google Maps 初始化失敗。";
        setMapError(text);
      }
    })();
    return () => {
      alive = false;
      mapClickListenerRef.current?.remove();
      mapClickListenerRef.current = null;
      markers.forEach((marker) => marker.setMap(null));
      markers.clear();
      clearSearchResultMarkers();
      placesServiceRef.current = null;
      googleMapRef.current = null;
      setMapReady(false);
    };
  }, [authReady]);

  useEffect(() => {
    const map = googleMapRef.current;
    const googleApi = window.google;
    if (!map || !googleApi?.maps) {
      return;
    }

    const nextIds = new Set(mapPlaces.map((place) => place.id));
    markerRefs.current.forEach((marker, placeId) => {
      if (!nextIds.has(placeId)) {
        marker.setMap(null);
        markerRefs.current.delete(placeId);
      }
    });

    mapPlaces.forEach((place) => {
      if (markerRefs.current.has(place.id)) {
        return;
      }
      const marker = new googleApi.maps.Marker({
        map,
        position: { lat: place.lat, lng: place.lng },
        title: place.name,
        label: place.recommended ? "推" : undefined
      });
      marker.addListener("click", () => setSelectedPlaceId(place.id));
      markerRefs.current.set(place.id, marker);
    });

    if (mapPlaces.length > 0) {
      const bounds = new googleApi.maps.LatLngBounds();
      mapPlaces.forEach((place) => bounds.extend({ lat: place.lat, lng: place.lng }));
      map.fitBounds(bounds, 80);
    }
  }, [mapPlaces]);

  useEffect(() => {
    const map = googleMapRef.current;
    const marker = selectedPlaceId ? markerRefs.current.get(selectedPlaceId) : null;
    if (!map || !marker) {
      return;
    }
    const position = marker.getPosition();
    if (position) {
      map.panTo(position);
    }
  }, [selectedPlaceId]);

  useEffect(() => {
    if (!isPendingModalOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPendingModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isPendingModalOpen]);

  useEffect(() => {
    if (!dayContextMenu) {
      return;
    }
    const closeMenu = () => setDayContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [dayContextMenu]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: getAuthHeaders()
        });
        if (!response.ok) {
          window.localStorage.removeItem("aiyo_token");
          router.replace("/login");
          return;
        }
        const data = (await response.json()) as { user?: { id?: number; email?: string } };
        if (!active) {
          return;
        }
        if (data.user?.id) {
          setChatSessionId(`user-${data.user.id}-default`);
        }
        setAuthEmail(data.user?.email ?? "");
        setAuthReady(true);
      } catch {
        if (active) {
          router.replace("/login");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    let alive = true;
    setModelsLoading(true);
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/models`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { models?: ChatModelOption[]; selected?: string };
        if (!alive) {
          return;
        }
        const models = payload.models ?? [];
        setModelOptions(models);
        if (payload.selected) {
          setSelectedModel(payload.selected);
        } else if (models.length > 0) {
          setSelectedModel(models[0].name);
        }
      } finally {
        if (alive) {
          setModelsLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !chatSessionId || chatSessionId === "session-anon") {
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/chat/history/${encodeURIComponent(chatSessionId)}`, {
          headers: getAuthHeaders()
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        if (!alive) {
          return;
        }
        const rows = (data.messages || [])
          .map((item) => ({
            role: item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "assistant",
            content: item.content || ""
          }))
          .filter((item) => item.content.trim().length > 0);
        setChatMessages(rows.length > 0 ? rows : INITIAL_CHAT_MESSAGES);
      } catch {
        // Ignore history load failures.
      }
    })();
    return () => {
      alive = false;
    };
  }, [authReady, chatSessionId]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const ws = new WebSocket(buildWsUrl(token));
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: "subscribe",
          sessionId: chatSessionId
        })
      );
    };

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          chunk?: string;
          sessionId?: string;
          action?: string;
        };
        if (data.type === "stream_response" && data.sessionId === chatSessionId && data.chunk) {
          const tokens = extractWsStreamTokens(data.chunk);
          if (tokens) {
            setWsStreamPreview((prev) => `${prev}${tokens}`.slice(-300));
            setChatMessages((prev) => {
              if (streamingViaSseRef.current) return prev;
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((item, index) =>
                  index === prev.length - 1 ? { ...item, content: `${item.content}${tokens}` } : item
                );
              }
              return [...prev, { role: "assistant" as const, content: tokens }];
            });
          }
        }
        if (data.type === "itinerary_update") {
          setWsItineraryEvents((prev) =>
            [{ action: data.action || "updated", at: new Date().toLocaleTimeString("zh-TW") }, ...prev].slice(0, 8)
          );
        }
      } catch {
        // Ignore malformed websocket payload.
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [authReady, chatSessionId]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    let alive = true;
    setProfileLoading(true);
    void (async () => {
      try {
        const [profileResponse, memoryResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/user/profile`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE_URL}/api/user/memory?limit=8`, { headers: getAuthHeaders() })
        ]);
        if (profileResponse.ok) {
          const profileData = (await profileResponse.json()) as { profile?: UserProfile };
          if (alive) {
            setProfile(profileData.profile || {});
          }
        }
        if (memoryResponse.ok) {
          const memoryData = (await memoryResponse.json()) as {
            items?: Array<{ id: number; memory_text: string; memory_type: string }>;
          };
          if (alive) {
            setMemoryItems(memoryData.items || []);
          }
        }
      } finally {
        if (alive) {
          setProfileLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [authReady]);

  useEffect(() => {
    const panel = chatScrollRef.current;
    if (!panel) {
      return;
    }
    panel.scrollTop = panel.scrollHeight;
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "zh-TW";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? "";
      }
      setChatInput(`${speechBaseInputRef.current}${transcript}`.trimStart());
    };
    recognition.onend = () => {
      setIsRecording(false);
    };
    recognition.onerror = () => {
      setIsRecording(false);
      setChatError("語音辨識失敗，請再試一次。");
    };

    speechRecognitionRef.current = recognition;
    setSpeechSupported(true);

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        // Ignore stop errors during unmount.
      }
      speechRecognitionRef.current = null;
    };
  }, []);

  function commit(mutator: (draft: PlannerState) => void) {
    const draft = deepCloneState(state);
    mutator(draft);
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(draft);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function selectDay(dayId: string) {
    commit((draft) => {
      draft.selectedDayId = dayId;
    });
  }

  function addDay() {
    commit((draft) => {
      const nextDay = buildNextDay(draft.days);
      const merged = [...draft.days, nextDay];
      const { days, idMap } = renumberDays(merged);
      draft.days = days;
      draft.selectedDayId = idMap[nextDay.id] ?? days.at(-1)?.id ?? draft.selectedDayId;
      draft.transportModes = remapTransportModes(draft.transportModes, idMap);
    });
  }

  function deleteDay(dayId: string) {
    commit((draft) => {
      if (draft.days.length <= 1) {
        return;
      }
      const selectedBefore = draft.selectedDayId;
      const filtered = draft.days.filter((day) => day.id !== dayId);
      const { days, idMap } = renumberDays(filtered);
      draft.days = days;
      draft.transportModes = remapTransportModes(draft.transportModes, idMap);
      draft.selectedDayId = dayId === selectedBefore ? days[0].id : idMap[selectedBefore] ?? days[0].id;
      setDayContextMenu(null);
    });
  }

  function reorderDays(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0) {
      return;
    }
    commit((draft) => {
      const selectedBefore = draft.selectedDayId;
      const next = [...draft.days];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const { days, idMap } = renumberDays(next);
      draft.days = days;
      draft.transportModes = remapTransportModes(draft.transportModes, idMap);
      draft.selectedDayId = idMap[selectedBefore] ?? days[0].id;
    });
  }

  function addToDayOrPending(placeId: string, target: string) {
    commit((draft) => {
      if (target === "pending") {
        if (!draft.pendingPlaceIds.includes(placeId)) {
          draft.pendingPlaceIds.push(placeId);
        }
        return;
      }
      draft.days = draft.days.map((day) =>
        day.id === target && !day.placeIds.includes(placeId)
          ? { ...day, placeIds: [...day.placeIds, placeId] }
          : day
      );
      draft.pendingPlaceIds = draft.pendingPlaceIds.filter((id) => id !== placeId);
    });
  }

  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0) {
      return;
    }
    commit((draft) => {
      draft.days = draft.days.map((day) => {
        if (day.id !== draft.selectedDayId) {
          return day;
        }
        const next = [...day.placeIds];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...day, placeIds: next };
      });
    });
  }

  function removeFromSelectedDay(placeId: string, index: number) {
    commit((draft) => {
      draft.days = draft.days.map((day) =>
        day.id === draft.selectedDayId
          ? { ...day, placeIds: day.placeIds.filter((id, idx) => !(id === placeId && idx === index)) }
          : day
      );
    });
  }

  function moveSinglePlaceTo(placeId: string, index: number, targetDayId: string) {
    if (!targetDayId) {
      return;
    }
    commit((draft) => {
      draft.days = draft.days.map((day) =>
        day.id === draft.selectedDayId
          ? { ...day, placeIds: day.placeIds.filter((id, idx) => !(id === placeId && idx === index)) }
          : day
      );
      draft.days = draft.days.map((day) =>
        day.id === targetDayId ? { ...day, placeIds: [...day.placeIds, placeId] } : day
      );
    });
  }

  function toggleMoveMenu(placeId: string, index: number) {
    const key = `${placeId}-${index}`;
    setOpenMoveMenuKey((current) => (current === key ? null : key));
  }

  function onSubmitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = chatInput.trim();
    if (!value || chatLoading) {
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: value };
    const baseMessages = trimChatMessages(chatMessages, CHAT_MEMORY_LIMIT);
    const nextMessages = trimChatMessages([...baseMessages, userMessage], CHAT_MEMORY_LIMIT);
    const assistantIndex = nextMessages.length;

    setChatError(null);
    setChatLoading(true);
    setChatInput("");
    setRecommendedVideos([]);
    setChatMessages(trimChatMessages([...nextMessages, { role: "assistant", content: "" }], CHAT_MEMORY_LIMIT + 1));
    streamingViaSseRef.current = true;

    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            sessionId: chatSessionId,
            message: value,
            messages: nextMessages,
            model: selectedModel || undefined
          })
        });

        if (!response.ok) {
          let errorText = "聊天服務暫時無法使用，請稍後再試。";
          try {
            const data = (await response.json()) as { error?: string };
            if (data.error) {
              errorText = data.error;
            }
          } catch {
            // Ignore JSON parse error and keep fallback text.
          }
          throw new Error(errorText);
        }

        if (!response.body) {
          throw new Error("目前無法取得串流回應。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";

        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) {
            break;
          }
          buffered += decoder.decode(chunk, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) {
              continue;
            }
            const payloadText = line.slice(5).trim();
            if (!payloadText) {
              continue;
            }
            try {
              const payload = JSON.parse(payloadText) as {
                token?: string;
                done?: boolean;
                error?: string;
                recommended_videos?: RecommendedVideo[];
              };
              if (payload.error) {
                throw new Error(payload.error);
              }
              if (payload.token) {
                setChatMessages((prev) =>
                  trimChatMessages(
                    prev.map((item, index) =>
                      index === assistantIndex ? { ...item, content: `${item.content}${payload.token}` } : item
                    ),
                    CHAT_MEMORY_LIMIT + 1
                  )
                );
              }
              if (payload.recommended_videos) {
                setRecommendedVideos(payload.recommended_videos.slice(0, 5));
              }
            } catch (error) {
              if (error instanceof Error) {
                throw error;
              }
              throw new Error("回應解析失敗。");
            }
          }
        }

        if (buffered.startsWith("data:")) {
          const payloadText = buffered.slice(5).trim();
          if (payloadText) {
            const payload = JSON.parse(payloadText) as { token?: string; recommended_videos?: RecommendedVideo[] };
            if (payload.token) {
              setChatMessages((prev) =>
                trimChatMessages(
                  prev.map((item, index) =>
                    index === assistantIndex ? { ...item, content: `${item.content}${payload.token}` } : item
                  ),
                  CHAT_MEMORY_LIMIT + 1
                )
              );
            }
            if (payload.recommended_videos) {
              setRecommendedVideos(payload.recommended_videos.slice(0, 5));
            }
          }
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "聊天服務暫時無法使用，請稍後再試。";
        setChatError(text);
        setChatMessages((prev) =>
          trimChatMessages(
            prev.map((item, index) =>
              index === assistantIndex
                ? { ...item, content: "目前無法取得 AI 回應。你可以稍後再試，或檢查模型服務是否正常。" }
                : item
            ),
            CHAT_MEMORY_LIMIT + 1
          )
        );
      } finally {
        streamingViaSseRef.current = false;
        setChatLoading(false);
      }
    })();
  }

  function clearChatHistory() {
    if (chatLoading) {
      return;
    }
    setChatError(null);
    setChatMessages(INITIAL_CHAT_MESSAGES);
    if (!authReady || chatSessionId === "session-anon") {
      return;
    }
    void fetch(`${API_BASE_URL}/api/chat/history/${encodeURIComponent(chatSessionId)}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
  }

  function startVoiceInput() {
    if (chatLoading || isRecording) {
      return;
    }
    if (!speechSupported || !speechRecognitionRef.current) {
      setChatError("目前瀏覽器不支援語音輸入。");
      return;
    }
    setChatError(null);
    speechBaseInputRef.current = chatInput;
    try {
      speechRecognitionRef.current.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      setChatError("無法啟動語音辨識，請稍後再試。");
    }
  }

  function stopVoiceInput() {
    if (!isRecording || !speechRecognitionRef.current) {
      return;
    }
    try {
      speechRecognitionRef.current.stop();
    } catch {
      setIsRecording(false);
    }
  }

  async function onSearchSegments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = segmentQuery.trim();
    if (!query || segmentLoading) {
      return;
    }
    setSegmentError(null);
    setSegmentLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/search-segments`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          query,
          city: segmentCity.trim() || undefined,
          limit: Math.max(1, Math.min(50, segmentLimit || 8))
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(data.error || data.detail || "片段檢索失敗。");
      }
      const data = (await response.json()) as { mode?: string; items?: SegmentSearchItem[] };
      setSegmentMode(data.mode || "");
      setSegmentItems(data.items || []);
    } catch (error) {
      setSegmentItems([]);
      setSegmentMode("");
      setSegmentError(error instanceof Error ? error.message : "片段檢索失敗。");
    } finally {
      setSegmentLoading(false);
    }
  }

  function formatSeconds(sec: number): string {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileSaving) {
      return;
    }
    setProfileSaving(true);
    setChatError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/profile`, {
        method: "PUT",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          displayName: profile.display_name ?? null,
          travelStyle: profile.travel_style ?? null,
          budgetPref: profile.budget_pref ?? null,
          pacePref: profile.pace_pref ?? null,
          transportPref: profile.transport_pref ?? null,
          dietaryPref: profile.dietary_pref ?? null,
          preferredCities: profile.preferred_cities ?? []
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "偏好儲存失敗");
      }
      const data = (await response.json()) as { profile?: UserProfile };
      setProfile(data.profile || {});
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "偏好儲存失敗");
    } finally {
      setProfileSaving(false);
    }
  }

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <strong>AI 對話推薦</strong>
        <div className="flex items-center gap-2">
          <button
            className="rounded border px-2 py-1 text-sm"
            type="button"
            onClick={() => router.push("/chat/sessions")}
          >
            歷史對話
          </button>
          <button
            className="rounded border px-2 py-1 text-sm disabled:opacity-60"
            onClick={clearChatHistory}
            disabled={chatLoading}
          >
            清除歷史
          </button>
          <button className="rounded border px-2 py-1 text-sm" onClick={() => setChatCollapsed((v) => !v)}>
            {chatCollapsed ? "展開" : "收合"}
          </button>
        </div>
      </div>
      {!chatCollapsed && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 rounded border border-slate-200 p-2 text-sm">
            <p className="mb-2 font-medium">個人化偏好（Skill）</p>
            <form className="grid grid-cols-1 gap-2 md:grid-cols-3" onSubmit={onSaveProfile}>
              <input
                className="rounded border px-2 py-1"
                value={profile.travel_style ?? ""}
                onChange={(event) => setProfile((prev) => ({ ...prev, travel_style: event.target.value }))}
                placeholder="旅遊風格（文青、親子、美食）"
                disabled={profileLoading || profileSaving}
              />
              <input
                className="rounded border px-2 py-1"
                value={profile.budget_pref ?? ""}
                onChange={(event) => setProfile((prev) => ({ ...prev, budget_pref: event.target.value }))}
                placeholder="預算偏好（高/中/低）"
                disabled={profileLoading || profileSaving}
              />
              <input
                className="rounded border px-2 py-1"
                value={profile.pace_pref ?? ""}
                onChange={(event) => setProfile((prev) => ({ ...prev, pace_pref: event.target.value }))}
                placeholder="行程節奏（慢/中/快）"
                disabled={profileLoading || profileSaving}
              />
              <input
                className="rounded border px-2 py-1"
                value={profile.transport_pref ?? ""}
                onChange={(event) => setProfile((prev) => ({ ...prev, transport_pref: event.target.value }))}
                placeholder="交通偏好（開車/大眾運輸）"
                disabled={profileLoading || profileSaving}
              />
              <input
                className="rounded border px-2 py-1"
                value={profile.dietary_pref ?? ""}
                onChange={(event) => setProfile((prev) => ({ ...prev, dietary_pref: event.target.value }))}
                placeholder="飲食限制（不吃牛、全素）"
                disabled={profileLoading || profileSaving}
              />
              <button className="rounded border px-2 py-1 disabled:opacity-60" type="submit" disabled={profileLoading || profileSaving}>
                {profileSaving ? "儲存中" : "儲存偏好"}
              </button>
            </form>
            <div className="mt-2 rounded bg-slate-50 p-2">
              <p className="mb-1 text-xs text-slate-500">近期記憶</p>
              {memoryItems.length === 0 ? (
                <p className="text-xs text-slate-500">尚無記憶資料。</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {memoryItems.map((item) => (
                    <li key={item.id} className="rounded border bg-white px-2 py-1">
                      [{item.memory_type}] {item.memory_text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="mb-2 rounded border border-slate-200 p-2 text-sm">
            <p className="mb-2 font-medium">即時通訊狀態</p>
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className={`rounded px-2 py-1 ${wsConnected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {wsConnected ? "WebSocket 已連線" : "WebSocket 未連線"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded bg-slate-50 p-2">
                <p className="mb-1 text-xs text-slate-500">stream_response 預覽</p>
                <p className="text-xs text-slate-700">{wsStreamPreview || "尚無資料"}</p>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <p className="mb-1 text-xs text-slate-500">itinerary_update</p>
                {wsItineraryEvents.length === 0 ? (
                  <p className="text-xs text-slate-600">尚無更新</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {wsItineraryEvents.map((item, index) => (
                      <li key={`${item.at}-${index}`}>
                        {item.at} - {item.action}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="mb-2 rounded border border-slate-200 p-2 text-sm">
            <p className="mb-2 font-medium">搜尋片段（測試）</p>
            <form className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-4" onSubmit={onSearchSegments}>
              <input
                className="rounded border px-2 py-1 md:col-span-2"
                value={segmentQuery}
                onChange={(event) => setSegmentQuery(event.target.value)}
                placeholder="輸入關鍵字，例如 台南 夜景"
                disabled={segmentLoading}
              />
              <input
                className="rounded border px-2 py-1"
                value={segmentCity}
                onChange={(event) => setSegmentCity(event.target.value)}
                placeholder="城市（選填）"
                disabled={segmentLoading}
              />
              <div className="flex gap-2">
                <input
                  className="w-20 rounded border px-2 py-1"
                  type="number"
                  min={1}
                  max={50}
                  value={segmentLimit}
                  onChange={(event) => setSegmentLimit(Number(event.target.value) || 8)}
                  disabled={segmentLoading}
                />
                <button className="rounded border px-3 py-1 disabled:opacity-60" type="submit" disabled={segmentLoading}>
                  {segmentLoading ? "搜尋中" : "搜尋"}
                </button>
              </div>
            </form>
            {segmentError && <p className="mb-2 text-xs text-red-600">{segmentError}</p>}
            {!segmentError && segmentItems.length > 0 && (
              <p className="mb-2 text-xs text-slate-500">
                模式：{segmentMode}，共 {segmentItems.length} 筆
              </p>
            )}
            <div className="max-h-40 overflow-auto rounded bg-slate-50 p-2">
              {segmentItems.length === 0 ? (
                <p className="text-xs text-slate-500">尚無結果。</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {segmentItems.map((item) => (
                    <li key={item.id} className="rounded border bg-white p-2">
                      <p className="font-medium">
                        segment #{item.id} / video #{item.video_id} / {item.start_sec}-{item.end_sec}s
                      </p>
                      {typeof item.distance === "number" && <p>distance: {item.distance.toFixed(4)}</p>}
                      <p>{item.summary || "(無摘要)"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-600">模型</label>
            <select
              className="rounded border px-2 py-1 disabled:opacity-60"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={chatLoading || modelsLoading || modelOptions.length === 0}
            >
              {modelOptions.length === 0 && <option value="">{modelsLoading ? "載入中" : "無可用模型"}</option>}
              {modelOptions.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">記憶上限：最近 {CHAT_MEMORY_LIMIT} 則訊息</span>
          </div>
          <div ref={chatScrollRef} className="mb-2 min-h-0 flex-1 overflow-auto rounded border bg-slate-50 p-2 text-sm">
            {chatMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`mb-2 rounded px-2 py-1 ${
                  message.role === "user" ? "ml-8 bg-slate-900 text-white" : "mr-8 bg-white"
                }`}
              >
                <p className={`mb-1 text-xs ${message.role === "user" ? "text-slate-200" : "text-slate-500"}`}>
                  {message.role === "user" ? "你" : message.role === "assistant" ? "AI" : "系統"}
                </p>
                <div
                  className={message.role === "user" ? "text-white" : "text-slate-900"}
                  dangerouslySetInnerHTML={{
                    __html: markdownToSafeHtml(message.content || (chatLoading && index === chatMessages.length - 1 ? "..." : ""))
                  }}
                />
              </div>
            ))}
          </div>
          {chatError && <p className="mb-2 text-xs text-red-600">{chatError}</p>}
          <form className="flex gap-2" onSubmit={onSubmitChat}>
            <input
              className="min-w-0 flex-1 rounded border px-2 py-1"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="輸入需求，例如想要親子與室內景點"
              disabled={chatLoading}
            />
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm disabled:opacity-60 ${isRecording ? "border-red-600 text-red-600" : ""}`}
              disabled={!speechSupported || chatLoading}
              onMouseDown={startVoiceInput}
              onMouseUp={stopVoiceInput}
              onMouseLeave={stopVoiceInput}
              onTouchStart={(event) => {
                event.preventDefault();
                startVoiceInput();
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                stopVoiceInput();
              }}
              aria-label="按住說話"
              title={speechSupported ? "按住說話" : "目前瀏覽器不支援語音輸入"}
            >
              {isRecording ? "錄音中" : "按住說話"}
            </button>
            <button
              className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-60"
              type="submit"
              disabled={chatLoading}
              aria-label="送出訊息"
              title="送出訊息"
            >
              {chatLoading ? (
                "回應中"
              ) : (
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 10L17 3L13 17L10 11L3 10Z" />
                </svg>
              )}
            </button>
          </form>
          <div className="mt-3 rounded border border-slate-200 p-2">
            <p className="mb-2 text-sm font-medium">AI 推薦影片（最多 5 支）</p>
            {recommendedVideos.length === 0 ? (
              <p className="text-xs text-slate-500">送出對話後會顯示推薦影片。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {recommendedVideos.map((video) => (
                  <button
                    key={video.video_id}
                    className="rounded border p-2 text-left"
                    onClick={() => {
                      setPlayerVideo(video);
                      setPlayerStartSec(video.segments?.[0]?.start_sec ?? 0);
                    }}
                    type="button"
                  >
                    <div className="mb-2 overflow-hidden rounded border bg-slate-100">
                      <img src={video.thumbnail_url} alt={video.title} className="h-24 w-full object-cover" />
                    </div>
                    <p className="text-sm font-medium">{video.title}</p>
                    <p className="line-clamp-2 text-xs text-slate-600">{video.summary || "無摘要"}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    !authReady ? (
      <main className="flex h-screen items-center justify-center">
        <p className="text-sm text-slate-600">驗證登入狀態中...</p>
      </main>
    ) : (
    <main className="h-screen p-3">
      <div className="grid h-full grid-cols-2 gap-3">
        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{authEmail || "已登入"}</span>
            <button
              className="rounded border px-2 py-1 text-sm"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem("aiyo_token");
                }
                router.replace("/login");
              }}
            >
              登出
            </button>
            <button className="rounded border px-3 py-1 text-sm" onClick={() => window.history.back()}>
              返回
            </button>
            <select className="rounded border px-2 py-1 text-sm" value={state.selectedDayId} onChange={(event) => selectDay(event.target.value)}>
              {state.days.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </select>
            <select
              className="rounded border px-2 py-1 text-sm"
              value={state.budgetMode}
              onChange={(event) => commit((draft) => void (draft.budgetMode = event.target.value as BudgetMode))}
            >
              <option value="A">預算模式 A：總預算與花費追蹤</option>
              <option value="B">預算模式 B：景點預估花費</option>
              <option value="C">預算模式 C：全部啟用</option>
            </select>
            <button
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
              disabled={historyIndex === 0}
              onClick={() => setHistoryIndex((idx) => Math.max(0, idx - 1))}
              aria-label="Undo"
              title="Undo"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4L6 10L12 16" />
              </svg>
            </button>
            <button
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
              disabled={historyIndex === history.length - 1}
              onClick={() => setHistoryIndex((idx) => Math.min(history.length - 1, idx + 1))}
              aria-label="Redo"
              title="Redo"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 4L14 10L8 16" />
              </svg>
            </button>
          </header>

          <div className="min-h-0 flex flex-1 flex-col p-3">
            <div className="mb-3 flex items-center gap-2">
              <div className={`min-w-0 flex-1 ${enableDayHorizontalScroll ? "overflow-x-auto" : ""}`}>
                <div className="flex w-max gap-2 pr-1">
                  {state.days.map((day) => (
                    <button
                      key={day.id}
                      className={`shrink-0 rounded border px-3 py-1 text-sm ${state.selectedDayId === day.id ? "bg-slate-900 text-white" : ""}`}
                      onClick={() => selectDay(day.id)}
                      draggable
                      onDragStart={() => setDayDragIndex(state.days.findIndex((item) => item.id === day.id))}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        const toIndex = state.days.findIndex((item) => item.id === day.id);
                        if (dayDragIndex !== null && toIndex >= 0) {
                          reorderDays(dayDragIndex, toIndex);
                        }
                        setDayDragIndex(null);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setDayContextMenu({ dayId: day.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      {day.id.toUpperCase()}
                    </button>
                  ))}
                  <button className="shrink-0 rounded border px-3 py-1 text-sm" onClick={addDay} aria-label="新增 DAY" title="新增 DAY">
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 4v12M4 10h12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="ml-auto flex shrink-0 gap-2">
                <button className="rounded border px-3 py-1 text-sm" onClick={() => setIsPendingModalOpen(true)}>
                  待安排清單
                </button>
                <button
                  className={`rounded border px-3 py-1 text-sm ${leftTab === "itinerary" ? "bg-slate-900 text-white" : ""}`}
                  onClick={() => setLeftTab("itinerary")}
                >
                  行程編輯
                </button>
                <button
                  className={`rounded border px-3 py-1 text-sm ${leftTab === "ai" ? "bg-slate-900 text-white" : ""}`}
                  onClick={() => setLeftTab("ai")}
                >
                  AI 對話
                </button>
              </div>
            </div>

            {dayContextMenu && (
              <div
                className="fixed z-50 rounded border border-slate-300 bg-white p-1 shadow-lg"
                style={{ left: dayContextMenu.x, top: dayContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="block w-full rounded px-3 py-1 text-left text-sm hover:bg-slate-100 disabled:opacity-40"
                  disabled={state.days.length <= 1}
                  onClick={() => deleteDay(dayContextMenu.dayId)}
                >
                  刪除
                </button>
              </div>
            )}

            {leftTab === "itinerary" && (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="mb-3 rounded-xl border border-slate-200 p-3">
                  <h2 className="mb-2 text-base font-semibold">每日行程：{selectedDay.label}</h2>

                  <div className="space-y-2">
                    {selectedDayPlaces.map((place, index) => (
                      <div key={`${place.id}-${index}`} className="rounded border border-slate-200 p-2">
                        <div
                          draggable
                          onDragStart={() => setDragIndex(index)}
                          onDrop={() => {
                            if (dragIndex !== null) {
                              reorder(dragIndex, index);
                            }
                            setDragIndex(null);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          className="group flex items-center gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{place.name}</div>
                            <div className="text-sm text-slate-600">預計停留 {place.stayMinutes} 分鐘</div>
                          </div>
                          <span className="invisible text-sm text-slate-500 group-hover:visible">拖拉排序</span>
                          <button
                            className="rounded border px-2 py-1 text-xs"
                            onClick={() =>
                              commit((draft) => {
                                draft.days = draft.days.map((day) =>
                                  day.id === draft.selectedDayId ? { ...day, placeIds: [...day.placeIds, place.id] } : day
                                );
                              })
                            }
                            aria-label="複製景點"
                            title="複製景點"
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <rect x="7" y="6" width="9" height="11" rx="1.8" />
                              <rect x="4" y="3" width="9" height="11" rx="1.8" />
                            </svg>
                          </button>
                          <button
                            className="rounded border px-2 py-1 text-xs"
                            onClick={() => removeFromSelectedDay(place.id, index)}
                            aria-label="刪除景點"
                            title="刪除景點"
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M4 6h12" />
                              <path d="M7 6V4h6v2" />
                              <path d="M6.5 6l.7 10h5.6l.7-10" />
                              <path d="M8.5 9.5v4.5M11.5 9.5v4.5" />
                            </svg>
                          </button>
                          <button
                            className="rounded border px-2 py-1 text-xs"
                            onClick={() => toggleMoveMenu(place.id, index)}
                            aria-label="設定移動"
                            title="設定移動"
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <circle cx="10" cy="10" r="3" />
                              <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M15.3 4.7l-1.6 1.6M6.3 13.7l-1.6 1.6" />
                            </svg>
                          </button>
                          {openMoveMenuKey === `${place.id}-${index}` && (
                            <select
                              className="rounded border px-1 py-1 text-xs"
                              defaultValue=""
                              onChange={(event) => {
                                const targetDayId = event.target.value;
                                if (!targetDayId) {
                                  return;
                                }
                                moveSinglePlaceTo(place.id, index, targetDayId);
                                setOpenMoveMenuKey(null);
                              }}
                            >
                              <option value="">選擇移動日</option>
                              {state.days
                                .filter((day) => day.id !== selectedDay.id)
                                .map((day) => (
                                  <option key={day.id} value={day.id}>
                                    {day.label}
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>

                        {index < selectedDayPlaces.length - 1 && (
                          <div className="mt-2 rounded bg-slate-50 p-2 text-sm">
                            {(() => {
                              const nextPlace = selectedDayPlaces[index + 1];
                              const pairKey = `${selectedDay.id}:${index}-${index + 1}`;
                              const mode = state.transportModes[pairKey] ?? "drive";
                              const estimate = estimateTransport(mode, mapDistanceKm(place, nextPlace));
                              const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                                place.name
                              )}&destination=${encodeURIComponent(nextPlace.name)}&travelmode=${
                                mode === "drive" ? "driving" : mode === "transit" ? "transit" : mode === "walk" ? "walking" : "bicycling"
                              }`;
                              return (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>交通方式</span>
                                  <select
                                    className="rounded border px-1 py-1"
                                    value={mode}
                                    onChange={(event) =>
                                      commit((draft) => void (draft.transportModes[pairKey] = event.target.value as TransportMode))
                                    }
                                  >
                                    <option value="drive">開車</option>
                                    <option value="transit">大眾運輸</option>
                                    <option value="walk">步行</option>
                                    <option value="bike">騎車</option>
                                  </select>
                                  <span>預計時間 {estimate.minutes} 分鐘</span>
                                  <span>距離 {estimate.distance}</span>
                                  <a className="rounded border px-2 py-1" href={mapUrl} target="_blank" rel="noreferrer">
                                    查看路線
                                  </a>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3 text-sm">
                  <h3 className="mb-2 text-base font-semibold">預算資訊</h3>
                  {(state.budgetMode === "A" || state.budgetMode === "C") && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <label>
                        總預算
                        <input
                          className="ml-1 w-24 rounded border px-2 py-1"
                          type="number"
                          value={state.totalBudget}
                          onChange={(event) => commit((draft) => void (draft.totalBudget = Number(event.target.value) || 0))}
                        />
                      </label>
                      <label>
                        已花費
                        <input
                          className="ml-1 w-24 rounded border px-2 py-1"
                          type="number"
                          value={state.spentBudget}
                          onChange={(event) => commit((draft) => void (draft.spentBudget = Number(event.target.value) || 0))}
                        />
                      </label>
                      <span>剩餘：{Math.max(state.totalBudget - state.spentBudget, 0)} 元</span>
                    </div>
                  )}
                  {(state.budgetMode === "B" || state.budgetMode === "C") && (
                    <div>
                      <p className="mb-1">本日景點預估花費：{estimatedDayCost} 元</p>
                      <ul className="space-y-1">
                        {selectedDayPlaces.map((place, index) => (
                          <li key={`${place.id}-${index}`} className="rounded bg-slate-50 px-2 py-1">
                            {place.name}：{place.estimatedCost} 元
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {leftTab === "ai" && <div className="min-h-0 flex-1">{chatPanel}</div>}
          </div>
        </section>

        <section className="relative rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={onMapSearchSubmit}>
              <div className="flex min-w-0 flex-1 items-center rounded border bg-white px-2">
                <span className="pr-2 text-slate-500">搜尋</span>
                <input
                  className="min-w-0 flex-1 border-0 px-0 py-1 outline-none"
                  placeholder="輸入地點名稱或地址"
                  value={searchText}
                  onChange={(event) => onMapSearchInputChange(event.target.value)}
                />
              </div>
              <button className="rounded border px-3 py-1 text-sm" type="submit">
                定位
              </button>
              <select
                className="rounded border px-2 py-1 text-sm"
                value={mapSearchMode}
                onChange={(event) => setMapSearchMode(event.target.value as "center" | "global")}
                title="搜尋範圍模式"
              >
                <option value="center">以地圖中心為主</option>
                <option value="global">全域搜尋</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                半徑(km)
                <input
                  className="w-16 rounded border px-1 py-1"
                  type="number"
                  min={1}
                  max={50}
                  value={mapSearchRadiusKm}
                  onChange={(event) => setMapSearchRadiusKm(Math.max(1, Math.min(50, Number(event.target.value) || 25)))}
                  disabled={mapSearchMode !== "center"}
                />
              </label>
              <button
                className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                type="button"
                onClick={locateCurrentPosition}
                disabled={locatingCurrentPosition}
              >
                {locatingCurrentPosition ? "定位中" : "用目前位置"}
              </button>
              {mapSearchResults.length > 0 && (
                <button className="rounded border px-3 py-1 text-sm" type="button" onClick={clearMapSearch}>
                  清除結果
                </button>
              )}
              <button className="rounded border px-3 py-1 text-sm" type="button" onClick={openStreetViewAtMapCenter}>
                開啟街景
              </button>
            </form>
          </div>
          {mapActionError && <p className="mb-2 text-xs text-red-600">{mapActionError}</p>}
          {mapSearchResults.length > 0 && (
            <div className="mb-2 max-h-36 overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
              <ul className="space-y-1 text-xs">
                {mapSearchResults.map((result, index) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-100"
                      onClick={() => focusSearchResult(result)}
                    >
                      <p className="font-medium">
                        {index + 1}. {result.name}
                      </p>
                      <p className="text-slate-500">{result.address}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="relative h-[calc(100%-54px)] overflow-hidden rounded-lg border">
            <div ref={mapContainerRef} className="h-full w-full" />
            {mapError && (
              <div className="absolute left-3 top-3 rounded border border-red-200 bg-white px-3 py-2 text-xs text-red-600">
                {mapError}
              </div>
            )}
            {!mapError && !mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-slate-600">
                地圖載入中...
              </div>
            )}

            {selectedPlace && (
              <div
                className="absolute right-3 top-3 w-[360px] max-w-[92%] rounded-xl border border-slate-300 bg-white p-3 text-sm shadow"
                onClick={(event) => event.stopPropagation()}
              >
              <h3 className="text-base font-semibold">{selectedPlace.name}</h3>
              <p className="mt-1 text-slate-600">{selectedPlace.intro}</p>

              <div className="mt-2 grid grid-cols-[88px_1fr] gap-y-1">
                <span className="text-slate-500">地址</span>
                <span>{selectedPlace.address}</span>
                <span className="text-slate-500">電話</span>
                <span>{selectedPlace.phone}</span>
                <span className="text-slate-500">網站</span>
                <a href={selectedPlace.website} className="underline" target="_blank" rel="noreferrer">
                  官方連結
                </a>
                <span className="text-slate-500">評分</span>
                <span>{selectedPlace.rating}</span>
                <span className="text-slate-500">營業時間</span>
                <span>{selectedPlace.hours}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {selectedPlace.reasons.map((reason) => (
                  <span key={reason} className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                    {reason}
                  </span>
                ))}
              </div>

              <ul className="mt-2 list-disc pl-5">
                {selectedPlace.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>

              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(selectedPlace.name)}`}
                  className="rounded border px-2 py-1"
                  target="_blank"
                  rel="noreferrer"
                >
                  用 Google 搜尋
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPlace.name)}`}
                  className="rounded border px-2 py-1"
                  target="_blank"
                  rel="noreferrer"
                >
                  用 Google Maps 打開
                </a>
                <button className="rounded border px-2 py-1" type="button" onClick={() => openStreetViewAt(selectedPlace.lat, selectedPlace.lng)}>
                  看街景
                </button>
              </div>

              <div className="mt-3 rounded border border-slate-200 p-2">
                <div className="mb-2 font-medium">新增到行程</div>
                <div className="flex flex-wrap gap-2">
                  {state.days.map((day) => (
                    <button key={day.id} className="rounded border px-2 py-1" onClick={() => addToDayOrPending(selectedPlace.id, day.id)}>
                      {day.id.toUpperCase()}
                    </button>
                  ))}
                  <button className="rounded border px-2 py-1" onClick={() => addToDayOrPending(selectedPlace.id, "pending")}>
                    加到待安排
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded border border-slate-200 p-2">
                <div className="mb-2 font-medium">評論（Google）</div>
                <ul className="list-disc pl-5">
                  {selectedPlace.googleComments.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {isPendingModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsPendingModalOpen(false)}
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">待安排景點清單</h3>
              <button className="rounded border px-3 py-1 text-sm" onClick={() => setIsPendingModalOpen(false)}>
                關閉
              </button>
            </div>
            {pendingPlaces.length === 0 ? (
              <p className="text-sm text-slate-600">目前沒有待安排景點。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {pendingPlaces.map((place) => (
                  <li key={place.id} className="rounded border border-slate-200 p-2">
                    <div className="mb-2 font-medium">{place.name}</div>
                    <div className="flex flex-wrap gap-2">
                      {state.days.map((day) => (
                        <button
                          key={day.id}
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() => addToDayOrPending(place.id, day.id)}
                        >
                          加到 {day.id.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {playerVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPlayerVideo(null)}>
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">{playerVideo.title}</p>
              <button className="rounded border px-2 py-1 text-sm" onClick={() => setPlayerVideo(null)}>
                關閉
              </button>
            </div>
            <div className="mb-3 aspect-video overflow-hidden rounded border">
              <iframe
                title={`player-${playerVideo.video_id}`}
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${playerVideo.youtube_id}?start=${playerStartSec}&autoplay=1`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <p className="mb-2 text-sm font-medium">影片片段時間戳記</p>
            <div className="max-h-48 overflow-auto rounded border bg-slate-50 p-2">
              {playerVideo.segments?.length ? (
                <ul className="space-y-2">
                  {playerVideo.segments.map((segment) => (
                    <li key={segment.segment_id} className="rounded border bg-white p-2 text-sm">
                      <button className="rounded border px-2 py-1 text-xs" onClick={() => setPlayerStartSec(segment.start_sec)} type="button">
                        跳轉 {formatSeconds(segment.start_sec)} - {formatSeconds(segment.end_sec)}
                      </button>
                      <p className="mt-1 text-xs text-slate-600">{segment.summary || "無摘要"}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">此影片目前沒有片段資料。</p>
              )}
            </div>
          </div>
        </div>
      )}

    </main>
    )
  );
}
