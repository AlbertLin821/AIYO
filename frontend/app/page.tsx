"use client";

import { FormEvent, Suspense, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TripPanel } from "@/components/trip/TripPanel";
import { VideoPlayerModal } from "@/components/video/VideoPanel";
import { Tabs } from "@/components/ui/tabs";
import { Modal, ModalHeader, ModalBody } from "@/components/ui/modal";
import { MessageCircle, Search, Heart } from "lucide-react";
import {
  API_BASE_URL,
  getAccessToken,
  getAuthHeaders,
  refreshAccessToken,
  apiFetchWithAuth,
} from "@/lib/api";

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

function parseDateFromDayLabel(label: string): Date | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(label);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const date = new Date(y, m, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const CHAT_SESSION_STORAGE_KEY = "aiyo_chat_session_id";
const ACTIVE_ITINERARY_STORAGE_KEY = "aiyo_active_itinerary_id";

function getStoredChatSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const stored = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  return (stored && stored.trim()) ? stored.trim() : "";
}

function persistChatSessionId(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId.trim()) {
    return;
  }
  window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, sessionId.trim());
}

function getStoredActiveItineraryId(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(ACTIVE_ITINERARY_STORAGE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function persistActiveItineraryId(id: number): void {
  if (typeof window === "undefined" || !Number.isFinite(id) || id <= 0) {
    return;
  }
  window.localStorage.setItem(ACTIVE_ITINERARY_STORAGE_KEY, String(id));
}

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

function HomePageInner() {
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
  const [isDateEditModalOpen, setIsDateEditModalOpen] = useState(false);
  const [dateEditValue, setDateEditValue] = useState("");
  const [dateEditDayId, setDateEditDayId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"itinerary" | "ai">("itinerary");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatDegraded, setChatDegraded] = useState(false);
  const [toolCallSummaries, setToolCallSummaries] = useState<ToolCallSummary[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(() => {
    const stored = getStoredChatSessionId();
    return stored || "";
  });
  const sessionFromUrl = searchParams.get("session");
  const itineraryFromUrl = searchParams.get("itineraryId");
  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl.trim()) {
      const id = sessionFromUrl.trim();
      persistChatSessionId(id);
      setChatSessionId(id);
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

  useEffect(() => {
    if (!authReady || itineraryFromUrl) {
      return;
    }
    const storedId = getStoredActiveItineraryId();
    if (storedId === null) {
      return;
    }
    void loadSavedItinerary(storedId);
    // loadSavedItinerary depends on runtime state and is intentionally re-bound per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  const state = history[historyIndex];
  const selectedDay = state.days.find((day) => day.id === state.selectedDayId) ?? state.days[0];
  const selectedPlace = places.find((item) => item.id === selectedPlaceId);

  const itineraryContentKey = useMemo(
    () =>
      JSON.stringify({
        days: state.days.map((d) => ({ id: d.id, placeIds: d.placeIds })),
        pending: state.pendingPlaceIds
      }),
    [state.days, state.pendingPlaceIds]
  );

  useEffect(() => {
    if (!authReady || !chatSessionId) {
      return;
    }
    const hasContent =
      state.days.some((d) => d.placeIds.length > 0) || state.pendingPlaceIds.length > 0;
    if (!hasContent) {
      return;
    }
    const t = setTimeout(() => {
      void saveItineraryToServer();
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itineraryContentKey drives debounced save
  }, [authReady, chatSessionId, itineraryContentKey]);

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
          const stored = getStoredChatSessionId();
          if (!stored) {
            const defaultId = `user-${data.user.id}-default`;
            persistChatSessionId(defaultId);
            setChatSessionId(defaultId);
          } else {
            setChatSessionId(stored);
          }
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

  function updateStartDate(startDate: Date) {
    if (Number.isNaN(startDate.getTime())) return;
    const weekdayText = ["日", "一", "二", "三", "四", "五", "六"];
    commit((draft) => {
      draft.days = draft.days.map((day, index) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + index);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dayNum = String(d.getDate()).padStart(2, "0");
        const label = `${y}/${m}/${dayNum} (${weekdayText[d.getDay()]})`;
        return { ...day, label };
      });
    });
  }

  function updateDayLabel(dayId: string, newLabel: string) {
    commit((draft) => {
      draft.days = draft.days.map((day) =>
        day.id === dayId ? { ...day, label: newLabel } : day
      );
    });
  }

  function openDateEditModal() {
    setDateEditDayId(null);
    const first = state.days[0];
    const date = first ? parseDateFromDayLabel(first.label) : null;
    setDateEditValue(date ? toDateInputValue(date) : toDateInputValue(new Date()));
    setIsDateEditModalOpen(true);
  }

  function openDateEditModalForDay(dayId: string) {
    const day = state.days.find((d) => d.id === dayId);
    const date = day ? parseDateFromDayLabel(day.label) : null;
    setDateEditDayId(dayId);
    setDateEditValue(date ? toDateInputValue(date) : toDateInputValue(new Date()));
    setIsDateEditModalOpen(true);
  }

  function confirmDateEdit() {
    const [y, m, d] = dateEditValue.split("-").map(Number);
    if (!y || !m || !d) return;
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return;
    if (dateEditDayId) {
      updateDayLabel(dateEditDayId, createDefaultDayLabel(date));
    } else {
      updateStartDate(date);
    }
    setIsDateEditModalOpen(false);
    setDateEditDayId(null);
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

  function upsertSearchResultPlace(result: MapSearchResult): string {
    const existed = places.find((p) => p.id === result.id);
    if (existed) {
      return existed.id;
    }
    places.push({
      id: result.id,
      name: result.name,
      intro: "",
      address: result.address,
      phone: "",
      website: "",
      rating: result.rating ?? 0,
      hours: "",
      reasons: [],
      notes: [],
      stayMinutes: 60,
      estimatedCost: 0,
      recommended: false,
      x: 0,
      y: 0,
      lat: result.lat,
      lng: result.lng,
      googleComments: []
    });
    return result.id;
  }

  function addSearchResultToDayOrPending(result: MapSearchResult, target: string) {
    const placeId = upsertSearchResultPlace(result);
    addToDayOrPending(placeId, target);
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
        const sid = data.session_id.trim();
        persistChatSessionId(sid);
        setChatSessionId(sid);
      }
      setActiveItineraryId(itineraryId);
      setSelectedItineraryId(itineraryId);
      persistActiveItineraryId(itineraryId);
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
          persistActiveItineraryId(data.id);
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


  const contentTabItems = [
    { id: "chat" as const, label: "Chat", icon: <MessageCircle size={14} /> },
    { id: "search" as const, label: "Search", icon: <Search size={14} /> },
    { id: "saved" as const, label: "Saved", icon: <Heart size={14} /> },
  ];
  const [contentTab, setContentTab] = useState<"chat" | "search" | "saved">("chat");
  const [tripPanelTab, setTripPanelTab] = useState("itinerary");
  const [showTripPanel, setShowTripPanel] = useState(false);
  const [searchAddMenuResultId, setSearchAddMenuResultId] = useState<string | null>(null);

  return (
    !authReady ? (
      <main className="flex h-screen items-center justify-center bg-surface">
        <p className="text-sm text-muted">Verifying authentication...</p>
      </main>
    ) : (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Left Sidebar */}
      <AppSidebar
        user={authEmail ? { name: authEmail.split("@")[0], username: authEmail.split("@")[0], avatar: undefined } : null}
        chatCount={chatMessages.filter(m => m.role === "user").length || undefined}
        savedCount={state.pendingPlaceIds.length || undefined}
        onNewChat={() => {
          const newId = createSessionId();
          persistChatSessionId(newId);
          setChatSessionId(newId);
          setChatMessages(INITIAL_CHAT_MESSAGES);
          setChatError(null);
          const nextState = createInitialState();
          setHistory([nextState]);
          setHistoryIndex(0);
        }}
      />

      {/* Main content area - Three column Mindtrip layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center column: Chat / Search / Saved + Map */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top Bar */}
          <TopBar
            tripName={state.days[0]?.label ? `Trip ${state.days.length} days` : undefined}
            destination={undefined}
            dates={state.days[0]?.label}
            travelers={undefined}
            budget={state.totalBudget > 0 ? `$${state.totalBudget}` : undefined}
            onInvite={() => void copyShareLink()}
            onCreateTrip={() => void saveItineraryToServer()}
            onEditDestination={() => {}}
            onEditDates={openDateEditModal}
            onEditTravelers={() => {}}
            onEditBudget={() => {}}
          />

          {/* Content area with tabs */}
          <div className="flex flex-1 overflow-hidden">
            {/* Center panel: Chat + Videos */}
            <div className="flex w-1/2 flex-col border-r border-border overflow-hidden">
              <div className="border-b border-border px-4 pt-3">
                <Tabs
                  items={contentTabItems}
                  activeId={contentTab}
                  onChange={(id) => setContentTab(id as "chat" | "search" | "saved")}
                />
              </div>

              {contentTab === "chat" && (
                <ChatPanel
                  messages={chatMessages}
                  chatInput={chatInput}
                  onChatInputChange={(v) => setChatInput(v)}
                  onSubmit={onSubmitChat}
                  chatLoading={chatLoading}
                  chatError={chatError}
                  chatDegraded={chatDegraded}
                  toolCallSummaries={toolCallSummaries}
                  speechSupported={speechSupported}
                  isRecording={isRecording}
                  onStartRecording={startVoiceInput}
                  onStopRecording={stopVoiceInput}
                />
              )}

              {contentTab === "search" && (
                <div className="flex flex-1 flex-col overflow-hidden p-4">
                  <p className="mb-2 text-xs text-muted">輸入關鍵字搜尋景點，點結果可定位地圖；點「加入行程」可加入指定天數或待排入。</p>
                  <form className="mb-4 flex items-center gap-2" onSubmit={onMapSearchSubmit}>
                    <div className="flex flex-1 items-center rounded-2xl border border-border bg-surface-muted px-4">
                      <Search size={16} className="text-muted mr-2" />
                      <input
                        id="map-search-input"
                        name="map-search"
                        ref={searchInputRef}
                        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-primary placeholder:text-muted outline-none"
                        placeholder="Search places..."
                        value={searchText}
                        onChange={(event) => onMapSearchInputChange(event.target.value)}
                        aria-label="搜尋地點"
                      />
                    </div>
                    <Button type="submit" size="sm">Search</Button>
                  </form>

                  {mapActionError && (
                    <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{mapActionError}</p>
                  )}

                  <div className="flex-1 overflow-y-auto space-y-2">
                    {mapSearchResults.map((result, index) => (
                      <div
                        key={result.id}
                        className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-muted"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          onClick={() => focusSearchResult(result)}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-sm font-semibold text-muted">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-primary">{result.name}</p>
                            <p className="text-xs text-muted truncate">{result.address}</p>
                          </div>
                          {result.rating && (
                            <span className="text-xs text-muted shrink-0">{result.rating}</span>
                          )}
                        </button>
                        <div className="relative shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setSearchAddMenuResultId((id) => (id === result.id ? null : result.id))}
                          >
                            加入行程
                          </Button>
                          {searchAddMenuResultId === result.id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                aria-hidden
                                onClick={() => setSearchAddMenuResultId(null)}
                              />
                              <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-border bg-surface py-1 shadow-modal">
                                {state.days.map((day, idx) => (
                                  <button
                                    key={day.id}
                                    type="button"
                                    className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-surface-muted"
                                    onClick={() => {
                                      addSearchResultToDayOrPending(result, day.id);
                                      setSearchAddMenuResultId(null);
                                    }}
                                  >
                                    Day {idx + 1}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 text-left text-sm text-muted hover:bg-surface-muted"
                                  onClick={() => {
                                    addSearchResultToDayOrPending(result, "pending");
                                    setSearchAddMenuResultId(null);
                                  }}
                                >
                                  待排入
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {mapSearchResults.length === 0 && !mapActionError && (
                      <p className="py-8 text-center text-sm text-muted">
                        Search for places to add to your trip
                      </p>
                    )}
                  </div>
                </div>
              )}

              {contentTab === "saved" && (
                <div className="flex flex-1 flex-col overflow-hidden p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-primary">Saved Itineraries</h3>
                    <Button size="sm" variant="outline" onClick={() => void saveItineraryToServer()}>
                      Save current
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {savedItineraries.map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-surface-muted transition-colors"
                        onClick={() => {
                          setSelectedItineraryId(item.id);
                          void loadSavedItinerary(item.id);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-primary">{item.title || "Untitled trip"}</p>
                          <p className="text-xs text-muted">
                            {item.days_count || 0} days {item.status && `/ ${item.status}`}
                          </p>
                        </div>
                      </button>
                    ))}
                    {savedItineraries.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted">
                        No saved trips yet
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right panel: Map + Trip Panel toggle */}
            <div className="flex w-1/2 flex-col overflow-hidden">
              {/* Map section */}
              <div className="relative flex-1">
                <div ref={mapContainerRef} className="h-full w-full" />
                {mapError && (
                  <div className="absolute left-3 top-3 rounded-lg border border-danger/20 bg-surface px-3 py-2 text-xs text-danger shadow-card">
                    {mapError}
                  </div>
                )}
                {!mapError && !mapReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm text-muted">
                    Loading map...
                  </div>
                )}

                {/* Place detail overlay */}
                {selectedPlace && (
                  <div
                    className="absolute right-3 top-3 w-[360px] max-w-[92%] rounded-2xl border border-border bg-surface p-4 text-sm shadow-modal animate-slide-up"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h3 className="text-base font-semibold text-primary">{selectedPlace.name}</h3>
                    <p className="mt-1 text-muted">{selectedPlace.intro}</p>

                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-start gap-2 text-xs">
                        <span className="w-16 shrink-0 text-muted">Address</span>
                        <span className="text-primary">{selectedPlace.address}</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs">
                        <span className="w-16 shrink-0 text-muted">Phone</span>
                        <span className="text-primary">{selectedPlace.phone}</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs">
                        <span className="w-16 shrink-0 text-muted">Rating</span>
                        <span className="text-primary">{selectedPlace.rating}</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs">
                        <span className="w-16 shrink-0 text-muted">Hours</span>
                        <span className="text-primary">{selectedPlace.hours}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedPlace.reasons.map((reason) => (
                        <span key={reason} className="rounded-btn bg-surface-muted px-2.5 py-1 text-xs text-primary">
                          {reason}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={selectedPlace.website}
                        className="rounded-btn border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-muted transition-colors"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Website
                      </a>
                      <button
                        className="rounded-btn border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-muted transition-colors"
                        type="button"
                        onClick={() => openStreetViewAt(selectedPlace.lat, selectedPlace.lng)}
                      >
                        Street View
                      </button>
                    </div>

                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-2 text-xs font-medium text-primary">Add to trip</p>
                      <div className="flex flex-wrap gap-1.5">
                        {state.days.map((day, idx) => (
                          <button
                            key={day.id}
                            className="rounded-btn bg-surface-muted px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
                            onClick={() => addToDayOrPending(selectedPlace.id, day.id)}
                          >
                            Day {idx + 1}
                          </button>
                        ))}
                        <button
                          className="rounded-btn border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-muted transition-colors"
                          onClick={() => addToDayOrPending(selectedPlace.id, "pending")}
                        >
                          Queue
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Trip panel toggle */}
                <button
                  onClick={() => setShowTripPanel(!showTripPanel)}
                  className="absolute right-3 bottom-3 z-10 rounded-btn bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-card hover:bg-primary/90 transition-colors"
                >
                  {showTripPanel ? "Hide itinerary" : "Show itinerary"}
                </button>
              </div>

              {/* Collapsible Trip Panel */}
              {showTripPanel && (
                <div className="h-1/2 border-t border-border overflow-hidden">
                  <TripPanel
                    tripName={`Trip ${state.days.length} days`}
                    dates={state.days[0]?.label}
                    days={state.days}
                    selectedDayId={state.selectedDayId}
                    dayTimeline={selectedDayTimeline}
                    places={places}
                    activeTab={tripPanelTab}
                    onTabChange={setTripPanelTab}
                    onSelectDay={selectDay}
                    onUndo={() => setHistoryIndex((idx) => Math.max(0, idx - 1))}
                    onRedo={() => setHistoryIndex((idx) => Math.min(history.length - 1, idx + 1))}
                    canUndo={historyIndex > 0}
                    canRedo={historyIndex < history.length - 1}
                    onPlaceDetails={(placeId) => setSelectedPlaceId(placeId)}
                    onPlaceRemove={(placeId, index) => removeFromSelectedDay(placeId, index)}
                    onPlaceDragStart={(index) => setDragIndex(index)}
                    onPlaceDrop={(index) => {
                      if (dragIndex !== null) { reorder(dragIndex, index); }
                      setDragIndex(null);
                    }}
                    onAddDay={addDay}
                    onEditDayLabel={openDateEditModalForDay}
                    onAddPlace={() => setContentTab("search")}
                    onSave={() => void saveItineraryToServer()}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Date edit modal */}
      <Modal open={isDateEditModalOpen} onClose={() => { setIsDateEditModalOpen(false); setDateEditDayId(null); }}>
        <ModalHeader>
          <h3 className="text-lg font-bold text-primary">
            {dateEditDayId ? "修改該天日期" : "修改行程日期"}
          </h3>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted">
            {dateEditDayId
              ? "選擇此天的日期。"
              : "設定行程開始日期，後續天數會依序遞增。"}
          </p>
          <div className="flex items-center gap-3">
            <label htmlFor="trip-start-date" className="text-sm font-medium text-primary shrink-0">開始日期</label>
            <input
              id="trip-start-date"
              name="trip-start-date"
              type="date"
              value={dateEditValue}
              onChange={(e) => setDateEditValue(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsDateEditModalOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={confirmDateEdit}>
              確定
            </Button>
          </div>
        </ModalBody>
      </Modal>

      {/* Pending places modal */}
      <Modal open={isPendingModalOpen} onClose={() => setIsPendingModalOpen(false)} maxWidth="max-w-2xl">
        <ModalHeader>
          <h3 className="text-lg font-bold text-primary">Queued places</h3>
        </ModalHeader>
        <ModalBody>
          {pendingPlaces.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No queued places.</p>
          ) : (
            <div className="space-y-3">
              {pendingPlaces.map((place) => (
                <div key={place.id} className="rounded-xl border border-border p-3">
                  <p className="mb-2 font-medium text-sm text-primary">{place.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {state.days.map((day, idx) => (
                      <button
                        key={day.id}
                        className="rounded-btn bg-surface-muted px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
                        onClick={() => addToDayOrPending(place.id, day.id)}
                      >
                        Day {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
      </Modal>

      {/* Video player modal */}
      {playerVideo && (
        <VideoPlayerModal
          video={playerVideo}
          startSec={playerStartSec}
          onClose={() => setPlayerVideo(null)}
          onJumpToTime={(sec) => setPlayerStartSec(sec)}
        />
      )}

    </div>
    )
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-surface">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    }>
      <HomePageInner />
    </Suspense>
  );
}
