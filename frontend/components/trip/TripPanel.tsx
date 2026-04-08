"use client";

import { useState } from "react";
import { ChevronDown, Undo2, Redo2, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import type { Place, DayPlan, TimelineItem, TransportMode } from "@/types/planner";
import { PlaceCard } from "./PlaceCard";

interface TripPanelProps {
  tripName: string;
  destination?: string;
  dates?: string;
  travelers?: number;
  budget?: string;
  days: DayPlan[];
  selectedDayId: string;
  dayTimeline: TimelineItem[];
  places: Place[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSelectDay: (dayId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onAddPlace?: () => void;
  onPlaceDetails?: (placeId: string) => void;
  onPlaceRemove?: (placeId: string, index: number) => void;
  onPlaceDragStart?: (index: number) => void;
  onPlaceDrop?: (index: number) => void;
  onAddDay?: () => void;
  onDeleteDay?: (dayId: string) => void;
  onEditDayLabel?: (dayId: string) => void;
  /** legIndex：第幾段（0 表示第 1 個景點與第 2 個景點之間） */
  onLegTransportModeChange?: (legIndex: number, mode: TransportMode) => void;
  onSave?: () => void;
  className?: string;
}

export function TripPanel({
  tripName,
  destination,
  dates,
  travelers,
  budget,
  days,
  selectedDayId,
  dayTimeline,
  places,
  activeTab,
  onTabChange,
  onSelectDay,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddPlace,
  onPlaceDetails,
  onPlaceRemove,
  onPlaceDragStart,
  onPlaceDrop,
  onAddDay,
  onDeleteDay,
  onEditDayLabel,
  onLegTransportModeChange,
  onSave,
  className,
}: TripPanelProps) {
  const selectedDay = days.find((d) => d.id === selectedDayId) || days[0];
  const selectedDayIndex = days.findIndex((d) => d.id === selectedDayId);

  const selectedDayPlaces = selectedDay
    ? selectedDay.placeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is Place => Boolean(p))
    : [];

  const [showDistances, setShowDistances] = useState(true);

  return (
    <div className={cn("flex h-full flex-col border-l border-border bg-surface", className)}>
      {/* Trip header */}
      <div className="border-b border-border p-6 pb-4">
        <h2 className="text-xl font-bold text-primary">{tripName}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {destination && <Tag>{destination}</Tag>}
          {dates && <Tag>{dates}</Tag>}
          {travelers && <Tag>{travelers} travelers</Tag>}
          {budget && <Tag>{budget}</Tag>}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Tabs
            items={[
              { id: "itinerary", label: "Itinerary" },
              { id: "calendar", label: "Calendar" },
              { id: "bookings", label: "Bookings" },
            ]}
            activeId={activeTab}
            onChange={onTabChange}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted transition-colors disabled:opacity-30"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted transition-colors disabled:opacity-30"
            >
              <Redo2 size={16} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted transition-colors"
              onClick={() => setShowDistances((v) => !v)}
              title={showDistances ? "Switch to compact view" : "Switch to detailed view"}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "itinerary" && (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-primary">
                  Itinerary {days.length} days
                </span>
                {onAddDay && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddDay}
                    className="gap-1.5"
                  >
                    <Plus size={14} />
                    新增天數
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowDistances((v) => !v)}
                  className="flex items-center gap-2 text-xs text-muted hover:text-primary transition-colors"
                  title={showDistances ? "隱藏景點間距離／時間" : "顯示景點間距離／時間"}
                >
                  <span>Distances</span>
                  <div
                    className={cn(
                      "h-5 w-9 rounded-full p-0.5 transition-colors",
                      showDistances ? "bg-primary" : "bg-surface-muted"
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-primary-foreground transition-transform",
                        showDistances ? "translate-x-4" : "translate-x-0.5"
                      )}
                    />
                  </div>
                </button>
              </div>
            </div>

            {days.map((day, dayIdx) => (
              <div key={day.id} className="mb-6">
                <div className="mb-3 flex w-full items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectDay(day.id)}
                    className="flex items-center gap-2 text-left"
                  >
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-muted transition-transform",
                        day.id === selectedDayId && "rotate-0",
                        day.id !== selectedDayId && "-rotate-90"
                      )}
                    />
                    <span className="text-sm font-semibold text-primary">
                      Day {dayIdx + 1}
                    </span>
                  </button>
                  {onEditDayLabel ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditDayLabel(day.id);
                      }}
                      className="text-sm text-muted hover:text-primary hover:underline"
                      title="修改日期"
                    >
                      {day.label}
                    </button>
                  ) : (
                    <span className="text-sm text-muted">{day.label}</span>
                  )}
                  <div className="ml-auto flex shrink-0 items-center">
                    {onDeleteDay && days.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteDay(day.id);
                        }}
                        className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-danger transition-colors"
                        title="刪除此天"
                        aria-label="刪除此天"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {day.id === selectedDayId && (
                  <div className="ml-2 border-l-2 border-border pl-4">
                    {selectedDayPlaces.map((place, index) => {
                      const timeItem = dayTimeline[index];
                      return (
                        <PlaceCard
                          key={`${place.id}-${index}`}
                          place={place}
                          index={index}
                          timeStart={timeItem?.arrivalText}
                          timeEnd={timeItem?.departText}
                          legFromPrev={
                            index > 0 && timeItem
                              ? {
                                  minutes: timeItem.travelMinutesFromPrev,
                                  mode: timeItem.travelModeFromPrev,
                                  distance: timeItem.travelDistanceFromPrev ?? "",
                                }
                              : undefined
                          }
                          onTransportModeChange={
                            index > 0 && onLegTransportModeChange
                              ? (mode) => onLegTransportModeChange(index - 1, mode)
                              : undefined
                          }
                          onDragStart={() => onPlaceDragStart?.(index)}
                          onDrop={() => onPlaceDrop?.(index)}
                          onDetails={() => onPlaceDetails?.(place.id)}
                          onRemove={() => onPlaceRemove?.(place.id, index)}
                        />
                      );
                    })}

                    {onAddPlace && (
                      <button
                        type="button"
                        onClick={onAddPlace}
                        className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted transition-colors"
                        title="切換至搜尋分頁以加入景點"
                      >
                        <Plus size={16} />
                        Add
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === "calendar" && (
          <div className="p-4">
            {days.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted">
                No days planned yet. Start chatting to create your itinerary.
              </div>
            ) : (
              <div className="space-y-3">
                {days.map((day, dayIdx) => {
                  const dayPlaces = day.placeIds
                    .map((id) => places.find((p) => p.id === id))
                    .filter((p): p is Place => Boolean(p));
                  return (
                    <div key={day.id} className="rounded-card border border-border p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-primary">Day {dayIdx + 1}</span>
                        <span className="text-xs text-muted">{day.label}</span>
                      </div>
                      <div className="space-y-1">
                        {dayPlaces.length === 0 ? (
                          <p className="text-xs text-muted">No places scheduled</p>
                        ) : dayPlaces.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 text-xs text-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                            {p.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "bookings" && (
          <div className="flex flex-col items-center justify-center p-8">
            <p className="text-sm text-muted mb-2">No bookings yet</p>
            <p className="text-xs text-muted text-center">
              Booking integration is in development. You can manage bookings externally for now.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
