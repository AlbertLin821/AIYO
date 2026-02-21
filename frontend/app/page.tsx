"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type TransportMode = "drive" | "transit" | "walk" | "bike";
type BudgetMode = "A" | "B" | "C";
type AiPanelMode = "A" | "B" | "C";
type MultiDayMode = "A" | "B" | "C";
type CommentMode = "A" | "B" | "C";
type LayerMode = "roadmap" | "satellite" | "terrain";
type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatModelOption = {
  name: string;
};

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
  const [history, setHistory] = useState<PlannerState[]>([initialState]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [layerMode, setLayerMode] = useState<LayerMode>("roadmap");
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
  const [chatSessionId] = useState(() => `session-${Date.now()}`);
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
    () =>
      places.filter(
        (item) =>
          usedOrRecommendedIds.has(item.id) &&
          (searchText.trim().length === 0 || item.name.includes(searchText.trim()))
      ),
    [searchText, usedOrRecommendedIds]
  );

  const selectedDayPlaces = selectedDay.placeIds
    .map((id) => getPlaceById(id))
    .filter((item): item is Place => Boolean(item));

  const pendingPlaces = state.pendingPlaceIds
    .map((id) => getPlaceById(id))
    .filter((item): item is Place => Boolean(item));

  const estimatedDayCost = selectedDayPlaces.reduce((sum, place) => sum + place.estimatedCost, 0);
  const enableDayHorizontalScroll = state.days.length > 5;

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
    let alive = true;
    setModelsLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/models");
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
  }, []);

  useEffect(() => {
    const panel = chatScrollRef.current;
    if (!panel) {
      return;
    }
    panel.scrollTop = panel.scrollHeight;
  }, [chatMessages, chatLoading]);

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
    setChatMessages(trimChatMessages([...nextMessages, { role: "assistant", content: "" }], CHAT_MEMORY_LIMIT + 1));

    void (async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
              const payload = JSON.parse(payloadText) as { token?: string; done?: boolean; error?: string };
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
            const payload = JSON.parse(payloadText) as { token?: string };
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
  }

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <strong>AI 對話推薦</strong>
        <div className="flex items-center gap-2">
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
        </div>
      )}
    </div>
  );

  return (
    <main className="h-screen p-3">
      <div className="grid h-full grid-cols-2 gap-3">
        <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
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
            <button className="rounded border px-2 py-1 text-sm" onClick={() => setIsPendingModalOpen(true)}>
              待安排清單
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
            <div className="flex min-w-0 flex-1 items-center rounded border bg-white px-2">
              <span className="pr-2 text-slate-500">搜尋</span>
              <input
                className="min-w-0 flex-1 border-0 px-0 py-1 outline-none"
                placeholder="輸入地點名稱"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 rounded border px-2 py-1">
              <span className="text-slate-500">圖層</span>
              <select className="rounded border px-2 py-1" value={layerMode} onChange={(event) => setLayerMode(event.target.value as LayerMode)}>
                <option value="roadmap">街道</option>
                <option value="satellite">衛星</option>
                <option value="terrain">地形</option>
              </select>
            </div>
          </div>

          <div
            className={`relative h-[calc(100%-54px)] overflow-hidden rounded-lg border ${
              layerMode === "roadmap"
                ? "bg-slate-100"
                : layerMode === "satellite"
                  ? "bg-[linear-gradient(120deg,#334155,#475569)]"
                  : "bg-[linear-gradient(120deg,#d9f99d,#86efac)]"
            }`}
            onClick={() => setSelectedPlaceId(null)}
          >
            {mapPlaces.map((place) => (
              <button
                key={place.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-3 py-1 text-xs ${
                  place.recommended ? "border-blue-600 bg-blue-600 text-white" : "border-slate-700 bg-white"
                }`}
                style={{ left: `${place.x}%`, top: `${place.y}%` }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedPlaceId(place.id);
                }}
              >
                {place.recommended ? "AI 推薦點" : "景點"}
              </button>
            ))}

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

    </main>
  );
}
