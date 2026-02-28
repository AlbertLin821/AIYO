"use client";

import { FormEvent, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

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

type UserProfile = {
  display_name?: string | null;
  travel_style?: string | null;
  budget_pref?: string | null;
  pace_pref?: string | null;
  transport_pref?: string | null;
  dietary_pref?: string | null;
  preferred_cities?: string[] | null;
};

type UserAiSettings = {
  tool_policy_json?: {
    enabled?: boolean;
    weather_use_current_location?: boolean;
    tool_trigger_rules?: string;
  } | null;
  weather_default_region?: string | null;
  auto_use_current_location?: boolean;
  current_lat?: number | null;
  current_lng?: number | null;
  current_region?: string | null;
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
  rank_position?: number;
  rank_score?: number;
  recommendation_reasons?: string[];
  score_breakdown?: Record<string, number>;
  source?: string;
};

type OptimizedSlot = {
  place_name: string;
  travel_minutes_from_prev: number;
  travel_mode?: string;
  travel_time_source?: string;
  stay_minutes?: number;
  time_start?: string;
  time_end?: string;
  notes?: string[];
};

type OptimizedDay = {
  day_number: number;
  total_cost?: number;
  total_travel_minutes?: number;
  warnings?: string[];
  slots: OptimizedSlot[];
};

type ItineraryOptimizationResult = {
  feasible: boolean;
  total_cost?: number;
  warnings?: string[];
  must_visit_missing?: string[];
  days: OptimizedDay[];
};

type SavedItinerarySummary = {
  id: number;
  title?: string | null;
  session_id?: string;
  days_count?: number;
  status?: string;
  updated_at?: string;
};

type SavedItinerarySlot = {
  place_name: string;
  slot_order?: number;
  time_range_start?: string | null;
  time_range_end?: string | null;
};

type SavedItineraryDay = {
  day_number: number;
  date_label?: string | null;
  slots: SavedItinerarySlot[];
};

type SavedItineraryDetail = SavedItinerarySummary & {
  days: SavedItineraryDay[];
};

type ToolCallSummary = {
  tool?: string;
  ok?: boolean;
  source?: string;
  error?: string | null;
  arguments?: Record<string, unknown>;
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

const places: Place[] = [];

function createDefaultDayLabel(baseDate = new Date()): string {
  const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];
  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, "0");
  const d = String(baseDate.getDate()).padStart(2, "0");
  return `${y}/${m}/${d} (${weekdayText[baseDate.getDay()]})`;
}

function createInitialState(): PlannerState {
  return {
    days: [{ id: "day1", label: createDefaultDayLabel(), placeIds: [] }],
    selectedDayId: "day1",
    pendingPlaceIds: [],
    transportModes: {},
    budgetMode: "C",
    totalBudget: 0,
    spentBudget: 0,
    aiPanelMode: "C",
    multiDayMode: "B",
    commentMode: "C"
  };
}

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

function toGoogleTravelMode(mode: TransportMode): google.maps.TravelMode {
  if (mode === "drive") return google.maps.TravelMode.DRIVING;
  if (mode === "walk") return google.maps.TravelMode.WALKING;
  if (mode === "bike") return google.maps.TravelMode.BICYCLING;
  return google.maps.TravelMode.TRANSIT;
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
const INITIAL_CHAT_MESSAGES: ChatMessage[] = [];
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  const [history, setHistory] = useState<PlannerState[]>([createInitialState()]);
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
  const [chatDegraded, setChatDegraded] = useState(false);
  const [toolCallSummaries, setToolCallSummaries] = useState<ToolCallSummary[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(() => createSessionId());
  const sessionFromUrl = searchParams.get("session");
  const itineraryFromUrl = searchParams.get("itineraryId");
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
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [profile, setProfile] = useState<UserProfile>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [aiSettings, setAiSettings] = useState<UserAiSettings>({});
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiSettingsNotice, setAiSettingsNotice] = useState<string | null>(null);
  const [memoryItems, setMemoryItems] = useState<Array<{ id: number; memory_text: string; memory_type: string }>>([]);
  const [memoryReviewing, setMemoryReviewing] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [recommendedVideos, setRecommendedVideos] = useState<RecommendedVideo[]>([]);
  const [optimizingItinerary, setOptimizingItinerary] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<ItineraryOptimizationResult | null>(null);
  const [savedItineraries, setSavedItineraries] = useState<SavedItinerarySummary[]>([]);
  const [selectedItineraryId, setSelectedItineraryId] = useState<number | null>(null);
  const [loadingSavedItinerary, setLoadingSavedItinerary] = useState(false);
  const [activeItineraryId, setActiveItineraryId] = useState<number | null>(null);
  const [playerVideo, setPlayerVideo] = useState<RecommendedVideo | null>(null);
  const [playerStartSec, setPlayerStartSec] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseInputRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamingViaSseRef = useRef(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const markerRefs = useRef<Map<string, google.maps.Marker>>(new Map());
  const searchResultMarkersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const searchBoxRef = useRef<google.maps.places.SearchBox | null>(null);
  const searchBoxPlacesChangedListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const searchBoxBoundsChangedListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const locationSyncOnceRef = useRef(false);
  const itineraryTouchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    void fetchSavedItineraryList();
    // fetchSavedItineraryList uses latest state via render closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !itineraryFromUrl) {
      return;
    }
    const parsed = Number(itineraryFromUrl);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    void loadSavedItinerary(parsed);
    // loadSavedItinerary depends on runtime state and is intentionally re-bound per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, itineraryFromUrl]);

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
  const selectedDayTimeline = useMemo(() => {
    let cursorMinutes = 9 * 60;
    return selectedDayPlaces.map((place, index) => {
      let travelMinutes = 0;
      let mode: TransportMode = "drive";
      if (index > 0) {
        const prev = selectedDayPlaces[index - 1];
        const pairKey = `${selectedDay.id}:${index - 1}-${index}`;
        mode = state.transportModes[pairKey] ?? "drive";
        travelMinutes = estimateTransport(mode, mapDistanceKm(prev, place)).minutes;
        cursorMinutes += travelMinutes;
      }
      const arrivalMinutes = cursorMinutes;
      const departMinutes = arrivalMinutes + place.stayMinutes;
      cursorMinutes = departMinutes;
      const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      return {
        placeId: place.id,
        placeName: place.name,
        arrivalText: fmt(arrivalMinutes),
        departText: fmt(departMinutes),
        stayMinutes: place.stayMinutes,
        travelMinutesFromPrev: travelMinutes,
        travelModeFromPrev: mode
      };
    });
  }, [selectedDay.id, selectedDayPlaces, state.transportModes]);

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

  function normalizePlaceResults(placeResults: google.maps.places.PlaceResult[]): MapSearchResult[] {
    const merged = new Map<string, MapSearchResult>();
    for (const item of placeResults) {
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
    return Array.from(merged.values());
  }

  async function searchFromAutocompletePredictions(
    query: string,
    map: google.maps.Map,
    googleApi: typeof google
  ): Promise<MapSearchResult[]> {
    const input = query.trim();
    if (!input) {
      return [];
    }

    const autocompleteService = new googleApi.maps.places.AutocompleteService();
    const boundedRequest: google.maps.places.AutocompletionRequest = { input };
    if (mapSearchMode === "center") {
      const bounds = map.getBounds();
      if (bounds) {
        boundedRequest.bounds = bounds;
      }
    }
    const globalRequest: google.maps.places.AutocompletionRequest = { input };

    const [boundedPredictions, globalPredictions, queryPredictions] = await Promise.all([
      new Promise<google.maps.places.AutocompletePrediction[]>((resolve) => {
        autocompleteService.getPlacePredictions(boundedRequest, (items, status) => {
          if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !items?.length) {
            resolve([]);
            return;
          }
          resolve(items.slice(0, 12));
        });
      }),
      new Promise<google.maps.places.AutocompletePrediction[]>((resolve) => {
        autocompleteService.getPlacePredictions(globalRequest, (items, status) => {
          if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !items?.length) {
            resolve([]);
            return;
          }
          resolve(items.slice(0, 12));
        });
      }),
      new Promise<google.maps.places.QueryAutocompletePrediction[]>((resolve) => {
        autocompleteService.getQueryPredictions({ input }, (items, status) => {
          if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !items?.length) {
            resolve([]);
            return;
          }
          resolve(items.slice(0, 8));
        });
      })
    ]);

    const predictionById = new Map<string, google.maps.places.AutocompletePrediction>();
    [...boundedPredictions, ...globalPredictions].forEach((item) => {
      if (!predictionById.has(item.place_id)) {
        predictionById.set(item.place_id, item);
      }
    });
    const predictions = Array.from(predictionById.values());

    const placesService = placesServiceRef.current ?? new googleApi.maps.places.PlacesService(map);
    placesServiceRef.current = placesService;
    const details =
      predictions.length > 0
        ? await Promise.all(
            predictions.map(
              (prediction) =>
                new Promise<MapSearchResult | null>((resolve) => {
                  placesService.getDetails(
                    {
                      placeId: prediction.place_id,
                      fields: ["place_id", "name", "formatted_address", "geometry", "rating"]
                    },
                    (item, status) => {
                      if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !item?.geometry?.location) {
                        resolve(null);
                        return;
                      }
                      resolve({
                        id: item.place_id ?? prediction.place_id,
                        name: item.name ?? prediction.structured_formatting.main_text ?? "未命名地點",
                        address: item.formatted_address ?? prediction.description ?? "無地址資訊",
                        lat: item.geometry.location.lat(),
                        lng: item.geometry.location.lng(),
                        rating: item.rating
                      });
                    }
                  );
                })
            )
          )
        : [];

    const queryTexts = new Set<string>();
    queryTexts.add(input);
    predictions.forEach((item) => queryTexts.add(item.description));
    queryPredictions.forEach((item) => queryTexts.add(item.description));
    const expandedQueryTexts = Array.from(queryTexts).slice(0, 10);
    const expandedByText = await Promise.all(
      expandedQueryTexts.map(
        (text) =>
          new Promise<google.maps.places.PlaceResult[]>((resolve) => {
            placesService.textSearch({ query: text }, (items, status) => {
              if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !items?.length) {
                resolve([]);
                return;
              }
              resolve(items);
            });
          })
      )
    );
    const expandedResults = normalizePlaceResults(expandedByText.flat());

    const merged = new Map<string, MapSearchResult>();
    for (const item of details) {
      if (!item) {
        continue;
      }
      if (!merged.has(item.id)) {
        merged.set(item.id, item);
      }
    }
    for (const item of expandedResults) {
      if (!merged.has(item.id)) {
        merged.set(item.id, item);
      }
    }
    return Array.from(merged.values());
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

    const predictionResults = await searchFromAutocompletePredictions(query, map, googleApi);

    const placesService = placesServiceRef.current ?? new googleApi.maps.places.PlacesService(map);
    placesServiceRef.current = placesService;
    setMapActionError(null);
    const mapCenter = map.getCenter() ?? null;
    const radiusMeters = Math.max(1000, Math.min(50000, Math.round(mapSearchRadiusKm * 1000)));
    const textSearchRequest: google.maps.places.TextSearchRequest =
      mapSearchMode === "center" && mapCenter
        ? { query, location: mapCenter, radius: radiusMeters }
        : { query };

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
              const normalized = normalizePlaceResults([item]);
              for (const normalizedItem of normalized) {
                if (!merged.has(normalizedItem.id)) {
                  merged.set(normalizedItem.id, normalizedItem);
                }
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
    if (items.length === 0 && !/[台臺]灣/.test(query)) {
      const withTaiwan = await searchWithPagination(
        mapSearchMode === "center" && mapCenter
          ? { query: `${query} 台灣`, location: mapCenter, radius: radiusMeters }
          : { query: `${query} 台灣` }
      );
      if (withTaiwan.items.length > 0) {
        status = withTaiwan.status;
        items = withTaiwan.items;
      }
    }
    if (mapSearchMode === "center" && items.length < 8) {
      const globalFallback = await searchWithPagination({ query });
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
    if (status === googleApi.maps.places.PlacesServiceStatus.REQUEST_DENIED && predictionResults.length === 0) {
      setMapSearchResults([]);
      clearSearchResultMarkers();
      setMapActionError("搜尋被拒絕（REQUEST_DENIED）。請確認前端金鑰已啟用 Places API。");
      return;
    }
    if (status === googleApi.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT && predictionResults.length === 0) {
      setMapSearchResults([]);
      clearSearchResultMarkers();
      setMapActionError("搜尋暫時超過查詢上限，請稍後再試。");
      return;
    }
    if ((status !== googleApi.maps.places.PlacesServiceStatus.OK || items.length === 0) && predictionResults.length === 0) {
      if (localMatches.length > 0) {
        const localResults: MapSearchResult[] = localMatches.map((place) => ({
          id: place.id,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating
        }));
        setSelectedPlaceId(localMatches[0].id);
        setMapSearchResults(localResults);
        setMapActionError(null);
        renderSearchResultsOnMap(localResults, map, googleApi);
        return;
      }
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
    const mergedById = new Map<string, MapSearchResult>();
    for (const item of predictionResults) {
      if (!mergedById.has(item.id)) {
        mergedById.set(item.id, item);
      }
    }
    for (const item of topResults) {
      if (!mergedById.has(item.id)) {
        mergedById.set(item.id, item);
      }
    }
    const finalResults = Array.from(mergedById.values()).slice(0, 50);
    if (finalResults.length === 0 && localMatches.length > 0) {
      const localResults: MapSearchResult[] = localMatches.map((place) => ({
        id: place.id,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating
      }));
      setSelectedPlaceId(localMatches[0].id);
      setMapSearchResults(localResults);
      setMapActionError(null);
      renderSearchResultsOnMap(localResults, map, googleApi);
      return;
    }

    setSelectedPlaceId(null);
    setMapSearchResults(finalResults);
    setMapActionError(null);
    renderSearchResultsOnMap(finalResults, map, googleApi);
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

  function getAuthHeaders(extra?: Record<string, string>, tokenOverride?: string): Record<string, string> {
    const token = tokenOverride ?? getAccessToken();
    return {
      ...(extra ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async function refreshAccessToken(): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error("refresh failed");
    }
    const data = (await response.json().catch(() => ({}))) as { token?: string; access_token?: string };
    const token = data.access_token || data.token || "";
    if (!token) {
      throw new Error("refresh token missing");
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aiyo_token", token);
    }
    return token;
  }

  async function apiFetchWithAuth(url: string, init?: RequestInit, allowRetry = true): Promise<Response> {
    const token = getAccessToken();
    const response = await fetch(url, {
      ...(init ?? {}),
      credentials: "include",
      headers: getAuthHeaders((init?.headers as Record<string, string> | undefined) ?? {}, token || "")
    });
    if (response.status !== 401 || !allowRetry) {
      return response;
    }
    const refreshedToken = await refreshAccessToken();
    return fetch(url, {
      ...(init ?? {}),
      credentials: "include",
      headers: getAuthHeaders((init?.headers as Record<string, string> | undefined) ?? {}, refreshedToken)
    });
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
          gestureHandling: "greedy",
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
      directionsRendererRef.current?.setMap(null);
      directionsRendererRef.current = null;
      directionsServiceRef.current = null;
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
    const googleApi = window.google;
    if (!map || !googleApi?.maps) {
      return;
    }
    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new googleApi.maps.DirectionsRenderer({
        suppressMarkers: false,
        preserveViewport: true,
        polylineOptions: { strokeColor: "#2563eb", strokeWeight: 5, strokeOpacity: 0.75 }
      });
      directionsRendererRef.current.setMap(map);
    }
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new googleApi.maps.DirectionsService();
    }
    if (selectedDayPlaces.length < 2) {
      directionsRendererRef.current.setMap(null);
      return;
    }
    directionsRendererRef.current.setMap(map);

    const firstLegMode = (state.transportModes[`${selectedDay.id}:0-1`] ?? "drive") as TransportMode;
    const origin = selectedDayPlaces[0];
    const destination = selectedDayPlaces[selectedDayPlaces.length - 1];
    const waypoints = selectedDayPlaces.slice(1, -1).map((place) => ({
      location: new googleApi.maps.LatLng(place.lat, place.lng),
      stopover: true
    }));
    const request: google.maps.DirectionsRequest = {
      origin: new googleApi.maps.LatLng(origin.lat, origin.lng),
      destination: new googleApi.maps.LatLng(destination.lat, destination.lng),
      waypoints,
      optimizeWaypoints: false,
      travelMode: toGoogleTravelMode(firstLegMode)
    };

    directionsServiceRef.current.route(request, (result, status) => {
      if (status === googleApi.maps.DirectionsStatus.OK && result) {
        directionsRendererRef.current?.setDirections(result);
      } else {
        directionsRendererRef.current?.setMap(null);
      }
    });
  }, [selectedDay.id, selectedDayPlaces, state.transportModes, mapReady]);

  useEffect(() => {
    const map = googleMapRef.current;
    const input = searchInputRef.current;
    const googleApi = window.google;
    if (!map || !input || !googleApi?.maps?.places) {
      return;
    }
    if (searchBoxRef.current) {
      return;
    }

    const searchBox = new googleApi.maps.places.SearchBox(input);
    searchBoxRef.current = searchBox;

    const updateSearchBounds = () => {
      const bounds = map.getBounds();
      if (bounds) {
        searchBox.setBounds(bounds);
      }
    };
    updateSearchBounds();
    searchBoxBoundsChangedListenerRef.current = map.addListener("bounds_changed", updateSearchBounds);

    searchBoxPlacesChangedListenerRef.current = searchBox.addListener("places_changed", () => {
      void (async () => {
        const placeResults = searchBox.getPlaces() ?? [];
        let results = normalizePlaceResults(placeResults);
        const inputQuery = input.value.trim();

        // SearchBox 通常只會回傳使用者點選的一筆，這裡補一次文字搜尋來擴展同名結果。
        if (results.length <= 1 && inputQuery) {
          const placesService = placesServiceRef.current ?? new googleApi.maps.places.PlacesService(map);
          placesServiceRef.current = placesService;
          const broadQuery = (placeResults[0]?.name?.trim() || inputQuery.split(",")[0]?.trim() || inputQuery).trim();
          const mapCenter = map.getCenter() ?? null;
          const radiusMeters = Math.max(1000, Math.min(50000, Math.round(mapSearchRadiusKm * 1000)));
          const request: google.maps.places.TextSearchRequest =
            mapSearchMode === "center" && mapCenter
              ? { query: broadQuery, location: mapCenter, radius: radiusMeters }
              : { query: broadQuery };

          const expanded = await new Promise<google.maps.places.PlaceResult[]>((resolve) => {
            placesService.textSearch(request, (textResults, status) => {
              if (status !== googleApi.maps.places.PlacesServiceStatus.OK || !textResults) {
                resolve([]);
                return;
              }
              resolve(textResults);
            });
          });

          const expandedResults = normalizePlaceResults(expanded);
          if (expandedResults.length > results.length) {
            results = expandedResults;
          }
        }

        if (results.length === 0) {
          setMapSearchResults([]);
          clearSearchResultMarkers();
          setMapActionError("找不到可顯示的地點，請嘗試其他關鍵字。");
          return;
        }

        setMapActionError(null);
        setSelectedPlaceId(null);
        setMapSearchResults(results);
        setSearchText(input.value);
        renderSearchResultsOnMap(results, map, googleApi);
      })();
    });

    return () => {
      searchBoxPlacesChangedListenerRef.current?.remove();
      searchBoxBoundsChangedListenerRef.current?.remove();
      searchBoxPlacesChangedListenerRef.current = null;
      searchBoxBoundsChangedListenerRef.current = null;
      searchBoxRef.current = null;
    };
  }, [mapReady]);

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
        const response = await apiFetchWithAuth(`${API_BASE_URL}/api/auth/me`);
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
    if (!authReady || !chatSessionId) {
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await apiFetchWithAuth(`${API_BASE_URL}/api/chat/history/${encodeURIComponent(chatSessionId)}`);
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
          .map((item): ChatMessage => {
            const role: ChatRole =
              item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "assistant";
            return {
              role,
              content: item.content || ""
            };
          })
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
      ws.send(
        JSON.stringify({
          type: "subscribe",
          sessionId: chatSessionId
        })
      );
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    ws.onerror = () => {};

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
      } catch {
        // Ignore malformed websocket payload.
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
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
        const [profileResponse, memoryResponse, aiSettingsResponse] = await Promise.all([
          apiFetchWithAuth(`${API_BASE_URL}/api/user/profile`),
          apiFetchWithAuth(`${API_BASE_URL}/api/user/memory?limit=8`),
          apiFetchWithAuth(`${API_BASE_URL}/api/user/ai-settings`)
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
        if (aiSettingsResponse.ok) {
          const aiData = (await aiSettingsResponse.json()) as { settings?: UserAiSettings };
          if (alive) {
            setAiSettings(aiData.settings || {});
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

  async function syncCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const response = await apiFetchWithAuth(`${API_BASE_URL}/api/user/location`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude
              })
            });
            if (response.ok) {
              const data = (await response.json()) as { settings?: UserAiSettings };
              setAiSettings((prev) => ({ ...prev, ...(data.settings || {}) }));
              setAiSettingsNotice("已更新目前位置，天氣問題可自動帶入你目前地區。");
            }
          } catch {
            // Ignore location sync errors to avoid interrupting chat.
          } finally {
            resolve();
          }
        },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  useEffect(() => {
    if (!authReady || locationSyncOnceRef.current) {
      return;
    }
    locationSyncOnceRef.current = true;
    void syncCurrentLocation();
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
    draft.budgetMode = "C";
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

  function onItineraryTouchStart(event: TouchEvent<HTMLDivElement>) {
    itineraryTouchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  }

  function onItineraryTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = itineraryTouchStartXRef.current;
    itineraryTouchStartXRef.current = null;
    if (startX === null) {
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (Math.abs(delta) < 60) {
      return;
    }
    const currentIndex = state.days.findIndex((day) => day.id === state.selectedDayId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = delta < 0 ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= state.days.length) {
      return;
    }
    selectDay(state.days[targetIndex].id);
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
    setChatDegraded(false);
    setChatLoading(true);
    setChatInput("");
    setRecommendedVideos([]);
    setToolCallSummaries([]);
    setChatMessages(trimChatMessages([...nextMessages, { role: "assistant", content: "" }], CHAT_MEMORY_LIMIT + 1));
    streamingViaSseRef.current = true;

    void (async () => {
      try {
        const resolvedChatCity =
          aiSettings.current_region?.trim() || aiSettings.weather_default_region?.trim() || undefined;
        const response = await apiFetchWithAuth(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: chatSessionId,
            message: value,
            messages: nextMessages,
            model: selectedModel || undefined,
            city: resolvedChatCity
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
                fallback?: boolean;
                tool_calls_summary?: ToolCallSummary[];
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
              if (payload.fallback) {
                setChatDegraded(true);
              }
              if (payload.done && payload.tool_calls_summary) {
                setToolCallSummaries(payload.tool_calls_summary.slice(0, 8));
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
            const payload = JSON.parse(payloadText) as {
              token?: string;
              recommended_videos?: RecommendedVideo[];
              fallback?: boolean;
              done?: boolean;
              tool_calls_summary?: ToolCallSummary[];
            };
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
            if (payload.fallback) {
              setChatDegraded(true);
            }
            if (payload.done && payload.tool_calls_summary) {
              setToolCallSummaries(payload.tool_calls_summary.slice(0, 8));
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
        void runAiMemoryReview();
      }
    })();
  }

  async function trackRecommendationEvent(
    eventType: string,
    video: RecommendedVideo,
    segmentId?: number | null,
  ) {
    if (!authReady) {
      return;
    }
    try {
      await apiFetchWithAuth(`${API_BASE_URL}/api/recommendation/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: eventType,
          session_id: chatSessionId,
          video_id: video.video_id ?? null,
          youtube_id: video.youtube_id,
          segment_id: segmentId ?? null,
          rank_position: video.rank_position ?? null,
          rank_score: video.rank_score ?? null,
          recommendation_reason: video.recommendation_reasons?.join("; ") ?? null,
          tool_source: video.source ?? null,
        }),
      });
    } catch {
      // Fire-and-forget; do not interrupt user flow.
    }
  }

  function buildItineraryDaysPayload() {
    return state.days.map((day, dayIndex) => ({
      day_number: dayIndex + 1,
      date_label: day.label,
      slots: day.placeIds
        .map((placeId, slotIndex) => {
          const place = getPlaceById(placeId);
          if (!place) {
            return null;
          }
          return {
            place_name: place.name,
            slot_order: slotIndex + 1,
            segment_id: null,
            place_id: null
          };
        })
        .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
    }));
  }

  async function fetchSavedItineraryList() {
    if (!authReady) {
      return;
    }
    try {
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary?limit=30`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { items?: SavedItinerarySummary[] };
      const items = Array.isArray(data.items) ? data.items : [];
      setSavedItineraries(items);
      if (!selectedItineraryId && items.length > 0) {
        setSelectedItineraryId(items[0].id);
      }
    } catch {
      // Ignore list fetch errors to avoid blocking UI.
    }
  }

  function upsertLoadedPlace(name: string, uniqueSeed: string): string {
    const normalized = name.trim().toLowerCase();
    const existed = places.find((item) => item.name.trim().toLowerCase() === normalized);
    if (existed) {
      return existed.id;
    }
    const placeId = `saved-${uniqueSeed}`;
    places.push({
      id: placeId,
      name: name.trim() || "未命名地點",
      intro: "由已儲存行程載入",
      address: "尚未提供地址",
      phone: "",
      website: "",
      rating: 0,
      hours: "",
      reasons: [],
      notes: [],
      stayMinutes: 60,
      estimatedCost: 0,
      recommended: false,
      x: 0,
      y: 0,
      lat: 23.5,
      lng: 121.0,
      googleComments: []
    });
    return placeId;
  }

  async function loadSavedItinerary(itineraryId: number) {
    if (!authReady || !itineraryId || loadingSavedItinerary) {
      return;
    }
    setLoadingSavedItinerary(true);
    setChatError(null);
    try {
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary/${itineraryId}`);
      const data = (await response.json().catch(() => ({}))) as SavedItineraryDetail & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "載入已儲存行程失敗");
      }
      const loadedDays = Array.isArray(data.days) ? data.days : [];
      const normalizedDays = loadedDays
        .sort((a, b) => Number(a.day_number || 0) - Number(b.day_number || 0))
        .map((day, dayIndex) => {
          const placeIds = (Array.isArray(day.slots) ? day.slots : [])
            .sort((a, b) => Number(a.slot_order || 0) - Number(b.slot_order || 0))
            .map((slot, slotIndex) =>
              upsertLoadedPlace(String(slot.place_name || "未命名地點"), `${itineraryId}-${dayIndex + 1}-${slotIndex + 1}`)
            );
          return {
            id: `day${dayIndex + 1}`,
            label: String(day.date_label || `DAY ${dayIndex + 1}`),
            placeIds
          };
        });
      if (normalizedDays.length === 0) {
        throw new Error("此行程尚未儲存任何景點。");
      }
      commit((draft) => {
        draft.days = normalizedDays;
        draft.selectedDayId = normalizedDays[0].id;
        draft.pendingPlaceIds = [];
        draft.transportModes = {};
      });
      if (typeof data.session_id === "string" && data.session_id.trim()) {
        setChatSessionId(data.session_id.trim());
      }
      setActiveItineraryId(itineraryId);
      setSelectedItineraryId(itineraryId);
      setAiSettingsNotice("已載入已儲存行程。");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "載入已儲存行程失敗");
    } finally {
      setLoadingSavedItinerary(false);
    }
  }

  async function saveItineraryToServer() {
    if (!authReady) {
      return;
    }
    try {
      const payload = {
        sessionId: chatSessionId,
        title: `${state.days[0]?.label ?? "行程"} (${state.days.length} 天)`,
        daysCount: state.days.length,
        status: "draft",
        days: buildItineraryDaysPayload()
      };
      const endpoint = activeItineraryId ? `${API_BASE_URL}/api/itinerary/${activeItineraryId}` : `${API_BASE_URL}/api/itinerary`;
      const method = activeItineraryId ? "PUT" : "POST";
      const response = await apiFetchWithAuth(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => ({}))) as SavedItinerarySummary & { error?: string };
      if (response.ok) {
        if (typeof data.id === "number") {
          setActiveItineraryId(data.id);
          setSelectedItineraryId(data.id);
        }
        setChatError(null);
        setAiSettingsNotice("行程已儲存至伺服器。");
        await fetchSavedItineraryList();
      } else {
        setChatError(data.error || "行程儲存失敗");
      }
    } catch {
      setChatError("行程儲存失敗，請檢查網路連線。");
    }
  }

  function buildPlannerSegmentsFromState(): Array<Record<string, unknown>> {
    const segments: Array<Record<string, unknown>> = [];
    state.days.forEach((day) => {
      day.placeIds.forEach((placeId) => {
        const place = getPlaceById(placeId);
        if (!place) {
          return;
        }
        segments.push({
          place_name: place.name,
          lat: place.lat,
          lng: place.lng,
          stay_minutes: place.stayMinutes,
          estimated_cost: place.estimatedCost,
          category: place.reasons[0] || ""
        });
      });
    });
    return segments;
  }

  async function reoptimizeItinerary() {
    if (!authReady || optimizingItinerary) {
      return;
    }
    const segments = buildPlannerSegmentsFromState();
    if (segments.length === 0) {
      setChatError("目前沒有可重新優化的景點。");
      return;
    }
    setOptimizingItinerary(true);
    setChatError(null);
    try {
      const budgetTotal = state.totalBudget > 0 ? state.totalBudget : null;
      const budgetPerDay = budgetTotal ? Math.round((budgetTotal / Math.max(1, state.days.length)) * 100) / 100 : null;
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/itinerary/reoptimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: state.days.length,
          segments,
          preferences: [profile.travel_style, profile.budget_pref, profile.pace_pref, profile.transport_pref].filter(Boolean),
          budgetTotal,
          budgetPerDay,
          mustVisit: [],
          avoid: []
        })
      });
      const data = (await response.json().catch(() => ({}))) as ItineraryOptimizationResult & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "重新優化失敗");
      }
      setOptimizationResult(data);
      setAiSettingsNotice("已完成重新優化，請查看可行性報告。");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "重新優化失敗");
    } finally {
      setOptimizingItinerary(false);
    }
  }

  function applyOptimizationResult() {
    if (!optimizationResult || !optimizationResult.days?.length) {
      return;
    }
    const availableByName = new Map<string, string[]>();
    const allPlaceIds = state.days.flatMap((day) => day.placeIds);
    allPlaceIds.forEach((placeId) => {
      const place = getPlaceById(placeId);
      if (!place) {
        return;
      }
      const key = place.name.trim().toLowerCase();
      const list = availableByName.get(key) ?? [];
      list.push(placeId);
      availableByName.set(key, list);
    });

    commit((draft) => {
      const nextDays = draft.days.map((day) => ({ ...day, placeIds: [] as string[] }));
      optimizationResult.days.forEach((optimizedDay, index) => {
        const targetDay = nextDays[index];
        if (!targetDay) {
          return;
        }
        optimizedDay.slots.forEach((slot) => {
          const key = (slot.place_name || "").trim().toLowerCase();
          if (!key) {
            return;
          }
          const queue = availableByName.get(key) ?? [];
          const picked = queue.shift();
          availableByName.set(key, queue);
          if (picked) {
            targetDay.placeIds.push(picked);
          }
        });
      });
      const used = new Set(nextDays.flatMap((day) => day.placeIds));
      const leftover = allPlaceIds.filter((id) => !used.has(id));
      draft.days = nextDays;
      draft.pendingPlaceIds = Array.from(new Set([...draft.pendingPlaceIds, ...leftover]));
    });
    setAiSettingsNotice("已套用優化排序。");
  }

  function exportItineraryAsPdf() {
    if (typeof window === "undefined") {
      return;
    }
    const textLines: string[] = [];
    textLines.push(`行程摘要（共 ${state.days.length} 天）`);
    textLines.push("");
    state.days.forEach((day, dayIdx) => {
      textLines.push(`Day ${dayIdx + 1} - ${day.label}`);
      day.placeIds.forEach((placeId, idx) => {
        const place = getPlaceById(placeId);
        if (!place) {
          return;
        }
        textLines.push(`  ${idx + 1}. ${place.name}`);
      });
      textLines.push("");
    });
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setChatError("無法開啟列印視窗，請檢查瀏覽器彈窗設定。");
      return;
    }
    popup.document.write(`<html><head><title>AIYO 行程匯出</title></head><body><pre>${escapeHtml(textLines.join("\n"))}</pre></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  function exportItineraryAsImage() {
    if (typeof window === "undefined") {
      return;
    }
    const canvas = document.createElement("canvas");
    const width = 1200;
    const rowHeight = 36;
    const titleHeight = 80;
    const totalRows = state.days.reduce((sum, day) => sum + 1 + day.placeIds.length, 0);
    const height = Math.max(300, titleHeight + totalRows * rowHeight + 40);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setChatError("圖片匯出失敗：無法建立畫布。");
      return;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText("AIYO 行程匯出", 40, 55);
    ctx.font = "20px sans-serif";
    let y = 95;
    state.days.forEach((day, dayIdx) => {
      ctx.fillStyle = "#111827";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`Day ${dayIdx + 1} - ${day.label}`, 40, y);
      y += rowHeight;
      day.placeIds.forEach((placeId, idx) => {
        const place = getPlaceById(placeId);
        if (!place) {
          return;
        }
        ctx.fillStyle = "#334155";
        ctx.font = "18px sans-serif";
        ctx.fillText(`${idx + 1}. ${place.name}`, 70, y);
        y += rowHeight;
      });
      y += 6;
    });
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `aiyo-itinerary-${Date.now()}.png`;
    link.click();
  }

  async function copyShareLink() {
    if (typeof window === "undefined") {
      return;
    }
    const id = activeItineraryId ?? selectedItineraryId;
    if (!id) {
      setChatError("請先儲存行程後再建立分享連結。");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(chatSessionId)}&itineraryId=${encodeURIComponent(String(id))}`;
    try {
      await navigator.clipboard.writeText(url);
      setAiSettingsNotice("已複製分享連結。");
    } catch {
      setChatError("無法複製分享連結，請手動複製網址列。");
    }
  }

  function clearChatHistory() {
    if (chatLoading) {
      return;
    }
    setChatError(null);
    setChatMessages(INITIAL_CHAT_MESSAGES);
    if (!authReady || !chatSessionId) {
      return;
    }
    void apiFetchWithAuth(`${API_BASE_URL}/api/chat/history/${encodeURIComponent(chatSessionId)}`, {
      method: "DELETE",
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
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/user/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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

  async function onSaveAiSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (aiSettingsSaving) {
      return;
    }
    setAiSettingsSaving(true);
    setAiSettingsNotice(null);
    setChatError(null);
    try {
      const response = await apiFetchWithAuth(`${API_BASE_URL}/api/user/ai-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolPolicy: {
            enabled: aiSettings.tool_policy_json?.enabled ?? true,
            weather_use_current_location: aiSettings.tool_policy_json?.weather_use_current_location ?? true,
            tool_trigger_rules: aiSettings.tool_policy_json?.tool_trigger_rules ?? ""
          },
          weatherDefaultRegion: aiSettings.weather_default_region ?? null,
          autoUseCurrentLocation: aiSettings.auto_use_current_location ?? true
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "AI 工具設定儲存失敗");
      }
      const data = (await response.json()) as { settings?: UserAiSettings };
      setAiSettings(data.settings || {});
      setAiSettingsNotice("AI 工具策略已更新。");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "AI 工具設定儲存失敗");
    } finally {
      setAiSettingsSaving(false);
    }
  }

  async function runAiMemoryReview() {
    if (memoryReviewing || !authReady) {
      return;
    }
    setMemoryReviewing(true);
    setMemoryNotice(null);
    setChatError(null);
    try {
      const rebuildResponse = await apiFetchWithAuth(`${API_BASE_URL}/api/user/memory/rebuild`, {
        method: "POST",
      });
      if (!rebuildResponse.ok) {
        const data = (await rebuildResponse.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(data.error || data.detail || "AI 記憶巡檢失敗");
      }
      const result = (await rebuildResponse.json()) as { inserted?: number; skipped?: number; candidates?: number };
      const memoryResponse = await apiFetchWithAuth(`${API_BASE_URL}/api/user/memory?limit=8`);
      if (memoryResponse.ok) {
        const memoryData = (await memoryResponse.json()) as {
          items?: Array<{ id: number; memory_text: string; memory_type: string }>;
        };
        setMemoryItems(memoryData.items || []);
      }
      setMemoryNotice(
        `AI 巡檢完成：候選 ${result.candidates ?? 0} 筆，新增 ${result.inserted ?? 0} 筆，略過重複 ${
          result.skipped ?? 0
        } 筆。`
      );
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "AI 記憶巡檢失敗");
    } finally {
      setMemoryReviewing(false);
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
              <p className="mb-2 text-xs font-medium text-slate-700">AI 工具策略設定</p>
              <form className="mb-2 space-y-2" onSubmit={onSaveAiSettings}>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={aiSettings.tool_policy_json?.enabled ?? true}
                    onChange={(event) =>
                      setAiSettings((prev) => ({
                        ...prev,
                        tool_policy_json: {
                          ...(prev.tool_policy_json || {}),
                          enabled: event.target.checked
                        }
                      }))
                    }
                    disabled={aiSettingsSaving}
                  />
                  啟用模型工具呼叫
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={aiSettings.auto_use_current_location ?? true}
                    onChange={(event) => setAiSettings((prev) => ({ ...prev, auto_use_current_location: event.target.checked }))}
                    disabled={aiSettingsSaving}
                  />
                  天氣查詢未指定地點時，自動使用目前位置
                </label>
                <input
                  className="w-full rounded border px-2 py-1 text-xs"
                  value={aiSettings.weather_default_region ?? ""}
                  onChange={(event) => setAiSettings((prev) => ({ ...prev, weather_default_region: event.target.value }))}
                  placeholder="預設地區（例如：台北）"
                  disabled={aiSettingsSaving}
                />
                <textarea
                  className="w-full rounded border px-2 py-1 text-xs"
                  rows={3}
                  value={aiSettings.tool_policy_json?.tool_trigger_rules ?? ""}
                  onChange={(event) =>
                    setAiSettings((prev) => ({
                      ...prev,
                      tool_policy_json: {
                        ...(prev.tool_policy_json || {}),
                        tool_trigger_rules: event.target.value
                      }
                    }))
                  }
                  placeholder="自訂工具觸發規則"
                  disabled={aiSettingsSaving}
                />
                <div className="flex items-center gap-2">
                  <button className="rounded border px-2 py-1 text-xs disabled:opacity-60" type="submit" disabled={aiSettingsSaving}>
                    {aiSettingsSaving ? "儲存中" : "儲存 AI 工具設定"}
                  </button>
                  <button
                    className="rounded border px-2 py-1 text-xs disabled:opacity-60"
                    type="button"
                    onClick={() => void syncCurrentLocation()}
                    disabled={aiSettingsSaving}
                  >
                    重新抓取目前位置
                  </button>
                </div>
              </form>
              {aiSettingsNotice && <p className="mb-1 text-xs text-emerald-700">{aiSettingsNotice}</p>}
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">近期記憶</p>
                <button
                  type="button"
                  className="rounded border px-2 py-0.5 text-xs disabled:opacity-60"
                  onClick={() => void runAiMemoryReview()}
                  disabled={memoryReviewing || profileLoading}
                >
                  {memoryReviewing ? "巡檢中" : "AI 檢查偏好"}
                </button>
              </div>
              <p className="mb-1 text-xs text-slate-600">每次送出訊息後會自動巡檢長期偏好（固定啟用）。</p>
              {memoryNotice && <p className="mb-1 text-xs text-emerald-700">{memoryNotice}</p>}
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
          {chatDegraded && (
            <p className="mb-2 text-xs text-amber-700">
              目前為短期記憶降級模式，長期偏好可能暫時未完整套用。
            </p>
          )}
          {toolCallSummaries.length > 0 && (
            <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
              <p className="mb-1 font-medium text-slate-700">本次工具使用</p>
              <ul className="space-y-1">
                {toolCallSummaries.map((item, index) => (
                  <li key={`${item.tool ?? "tool"}-${index}`} className="rounded bg-white px-2 py-1">
                    <span className="font-medium">{item.tool ?? "unknown"}</span>
                    {" / "}
                    <span className={item.ok ? "text-emerald-700" : "text-red-600"}>{item.ok ? "成功" : "失敗"}</span>
                    {item.source ? ` / ${item.source}` : ""}
                    {item.error ? ` / ${item.error}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
                {recommendedVideos.map((video) => (
                  <div
                    key={video.video_id ?? video.youtube_id}
                    className="w-[280px] shrink-0 snap-start rounded border bg-white p-2 md:w-[320px]"
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        setPlayerVideo(video);
                        setPlayerStartSec(video.segments?.[0]?.start_sec ?? 0);
                        void trackRecommendationEvent("click", video);
                      }}
                      type="button"
                    >
                      <div className="mb-2 overflow-hidden rounded border bg-slate-100">
                        <img src={video.thumbnail_url} alt={video.title} className="h-24 w-full object-cover" />
                      </div>
                      <p className="text-sm font-medium">{video.title}</p>
                      {video.city && <span className="mr-1 inline-block rounded bg-blue-50 px-1 text-xs text-blue-700">{video.city}</span>}
                      {video.source && <span className="inline-block rounded bg-slate-100 px-1 text-xs text-slate-500">{video.source}</span>}
                      <p className="line-clamp-2 text-xs text-slate-600">{video.summary || "無摘要"}</p>
                    </button>
                    {video.recommendation_reasons && video.recommendation_reasons.length > 0 && (
                      <div className="mt-1 rounded bg-emerald-50 px-2 py-1">
                        <p className="text-xs font-medium text-emerald-800">為何推薦</p>
                        <ul className="list-disc pl-4 text-xs text-emerald-700">
                          {video.recommendation_reasons.map((reason, rIdx) => (
                            <li key={rIdx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {video.segments && video.segments.length > 0 && (
                      <div className="mt-1 max-h-24 overflow-y-auto">
                        <div className="flex flex-wrap gap-1">
                        {video.segments.map((seg) => {
                          const startMin = Math.floor((seg.start_sec ?? 0) / 60);
                          const startSec = (seg.start_sec ?? 0) % 60;
                          const label = `${startMin}:${String(startSec).padStart(2, "0")}`;
                          const ytUrl = `https://www.youtube.com/watch?v=${video.youtube_id}&t=${seg.start_sec ?? 0}`;
                          return (
                            <a
                              key={seg.segment_id ?? seg.start_sec}
                              href={ytUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
                              title={seg.summary || `片段 ${label}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void trackRecommendationEvent("segment_jump", video, seg.segment_id);
                              }}
                            >
                              {label}
                            </a>
                          );
                        })}
                        </div>
                      </div>
                    )}
                  </div>
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
    <main className="min-h-screen p-2 md:p-3">
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold">AIYO 愛遊：一句話找到靈感，快速生成可行行程</h1>
            <p className="text-sm text-slate-600">語音對話、影片片段推薦、地圖路線與行程編排整合在同一個畫面。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setLeftTab("ai")}>
              按住說話
            </Button>
            <div className="flex items-end gap-1 rounded border px-2 py-1">
              <span className="h-2 w-1 animate-pulse rounded bg-slate-500" />
              <span className="h-3 w-1 animate-pulse rounded bg-slate-600 [animation-delay:120ms]" />
              <span className="h-4 w-1 animate-pulse rounded bg-slate-700 [animation-delay:240ms]" />
              <span className="h-3 w-1 animate-pulse rounded bg-slate-600 [animation-delay:360ms]" />
              <span className="h-2 w-1 animate-pulse rounded bg-slate-500 [animation-delay:480ms]" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid min-h-[calc(100vh-7rem)] grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{authEmail || "已登入"}</span>
            <button
              className="rounded border px-2 py-1 text-sm"
              onClick={() => {
                void (async () => {
                  try {
                    await apiFetchWithAuth(`${API_BASE_URL}/api/auth/logout`, { method: "POST" }, false);
                  } catch {
                    // Ignore logout API failures and clear client state anyway.
                  } finally {
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem("aiyo_token");
                    }
                    router.replace("/login");
                  }
                })();
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
            <span className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700">預算模式 C：全部啟用</span>
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
                <button className="rounded border px-3 py-1 text-sm" onClick={() => void saveItineraryToServer()}>
                  儲存行程
                </button>
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={selectedItineraryId ?? ""}
                  onChange={(event) => setSelectedItineraryId(Number(event.target.value) || null)}
                >
                  <option value="">選擇已儲存行程</option>
                  {savedItineraries.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.id} {item.title || "未命名行程"}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                  onClick={() => selectedItineraryId && void loadSavedItinerary(selectedItineraryId)}
                  disabled={!selectedItineraryId || loadingSavedItinerary}
                >
                  {loadingSavedItinerary ? "載入中" : "載入行程"}
                </button>
                <button
                  className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                  onClick={() => void reoptimizeItinerary()}
                  disabled={optimizingItinerary}
                >
                  {optimizingItinerary ? "優化中" : "重新優化"}
                </button>
                <button
                  className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                  onClick={applyOptimizationResult}
                  disabled={!optimizationResult}
                >
                  套用優化排序
                </button>
                <button className="rounded border px-3 py-1 text-sm" onClick={exportItineraryAsPdf}>
                  匯出 PDF
                </button>
                <button className="rounded border px-3 py-1 text-sm" onClick={exportItineraryAsImage}>
                  匯出圖片
                </button>
                <button className="rounded border px-3 py-1 text-sm" onClick={() => void copyShareLink()}>
                  分享連結
                </button>
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
              <div
                className="min-h-0 flex-1 overflow-auto"
                onTouchStart={onItineraryTouchStart}
                onTouchEnd={onItineraryTouchEnd}
              >
                {optimizationResult && (
                  <div className="mb-3 rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">行程可行性報告</h3>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          optimizationResult.feasible ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {optimizationResult.feasible ? "可行" : "需調整"}
                      </span>
                      <span className="text-xs text-slate-500">總費用：{Math.round(Number(optimizationResult.total_cost || 0))} 元</span>
                    </div>
                    {Array.isArray(optimizationResult.warnings) && optimizationResult.warnings.length > 0 && (
                      <ul className="mb-2 list-disc space-y-1 pl-5 text-amber-700">
                        {optimizationResult.warnings.map((warning, idx) => (
                          <li key={`global-warning-${idx}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <div className="space-y-2">
                      {optimizationResult.days.map((day) => (
                        <div key={`report-day-${day.day_number}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <strong>Day {day.day_number}</strong>
                            <span>交通總時長：{Math.round(Number(day.total_travel_minutes || 0))} 分鐘</span>
                            <span>預估花費：{Math.round(Number(day.total_cost || 0))} 元</span>
                          </div>
                          {Array.isArray(day.warnings) && day.warnings.length > 0 && (
                            <ul className="list-disc space-y-1 pl-5 text-amber-700">
                              {day.warnings.map((warning, idx) => (
                                <li key={`day-warning-${day.day_number}-${idx}`}>{warning}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

                <div className="mb-3 rounded-xl border border-slate-200 p-3 text-sm">
                  <h3 className="mb-2 text-base font-semibold">行程時間軸</h3>
                  {selectedDayTimeline.length === 0 ? (
                    <p className="text-slate-500">目前沒有景點可顯示時間軸。</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedDayTimeline.map((item, idx) => (
                        <li key={`${item.placeId}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong>{item.placeName}</strong>
                            <span className="text-xs text-slate-600">
                              {item.arrivalText} - {item.departText}
                            </span>
                            <span className="text-xs text-slate-500">停留 {item.stayMinutes} 分鐘</span>
                          </div>
                          {idx > 0 && (
                            <p className="mt-1 text-xs text-slate-600">
                              前段交通：{item.travelMinutesFromPrev} 分鐘（{item.travelModeFromPrev === "drive"
                                ? "開車"
                                : item.travelModeFromPrev === "transit"
                                  ? "大眾運輸"
                                  : item.travelModeFromPrev === "walk"
                                    ? "步行"
                                    : "騎車"}
                              ）
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
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

        <section className="relative flex min-h-[420px] flex-col rounded-xl border border-slate-200 bg-white p-3 xl:min-h-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={onMapSearchSubmit}>
              <div className="flex min-w-0 flex-1 items-center rounded border bg-white px-2">
                <span className="pr-2 text-slate-500">搜尋</span>
                <input
                  ref={searchInputRef}
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

          <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-lg border">
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
