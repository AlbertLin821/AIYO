export type TransportMode = "drive" | "transit" | "walk" | "bike";
export type BudgetMode = "A" | "B" | "C";
export type AiPanelMode = "A" | "B" | "C";
export type MultiDayMode = "A" | "B" | "C";
export type CommentMode = "A" | "B" | "C";
export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatModelOption = {
  name: string;
};

export type MapSearchResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
};

export type UserProfile = {
  display_name?: string | null;
  travel_style?: string | null;
  budget_pref?: string | null;
  pace_pref?: string | null;
  transport_pref?: string | null;
  dietary_pref?: string | null;
  preferred_cities?: string[] | null;
};

export type UserAiSettings = {
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

export type RecommendedSegment = {
  segment_id: number;
  start_sec: number;
  end_sec: number;
  summary?: string;
};

export type RecommendedVideo = {
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

export type OptimizedSlot = {
  place_name: string;
  travel_minutes_from_prev: number;
  travel_mode?: string;
  travel_time_source?: string;
  stay_minutes?: number;
  time_start?: string;
  time_end?: string;
  notes?: string[];
};

export type OptimizedDay = {
  day_number: number;
  total_cost?: number;
  total_travel_minutes?: number;
  warnings?: string[];
  slots: OptimizedSlot[];
};

export type ItineraryOptimizationResult = {
  feasible: boolean;
  total_cost?: number;
  warnings?: string[];
  must_visit_missing?: string[];
  days: OptimizedDay[];
};

export type SavedItinerarySummary = {
  id: number;
  title?: string | null;
  session_id?: string;
  days_count?: number;
  status?: string;
  updated_at?: string;
};

export type SavedItinerarySlot = {
  place_name: string;
  slot_order?: number;
  time_range_start?: string | null;
  time_range_end?: string | null;
};

export type SavedItineraryDay = {
  day_number: number;
  date_label?: string | null;
  slots: SavedItinerarySlot[];
};

export type SavedItineraryDetail = SavedItinerarySummary & {
  days: SavedItineraryDay[];
};

export type ToolCallSummary = {
  tool?: string;
  ok?: boolean;
  source?: string;
  error?: string | null;
  arguments?: Record<string, unknown>;
};

export type Place = {
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

export type DayPlan = {
  id: string;
  label: string;
  placeIds: string[];
};

export type PlannerState = {
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

export type TimelineItem = {
  placeId: string;
  placeName: string;
  arrivalText: string;
  departText: string;
  stayMinutes: number;
  travelMinutesFromPrev: number;
  travelModeFromPrev: TransportMode;
};
