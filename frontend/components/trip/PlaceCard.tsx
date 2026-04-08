"use client";

import { MoreHorizontal, ExternalLink, GripVertical, Car, Bus, Bike, PersonStanding } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Place, TransportMode } from "@/types/planner";

export interface LegTransport {
  minutes: number;
  mode: TransportMode;
  distance: string;
}

interface PlaceCardProps {
  place: Place;
  index: number;
  timeStart?: string;
  timeEnd?: string;
  /** 與上一個景點之間的交通段（僅 index > 0） */
  legFromPrev?: LegTransport | null;
  onTransportModeChange?: (mode: TransportMode) => void;
  onDragStart?: () => void;
  onDrop?: () => void;
  onRemove?: () => void;
  onDetails?: () => void;
  onLink?: () => void;
  className?: string;
}

const MODE_BUTTONS: { mode: TransportMode; Icon: typeof Car; label: string }[] = [
  { mode: "drive", Icon: Car, label: "開車" },
  { mode: "transit", Icon: Bus, label: "大眾運輸" },
  { mode: "bike", Icon: Bike, label: "騎車" },
  { mode: "walk", Icon: PersonStanding, label: "步行" },
];

export function PlaceCard({
  place,
  index,
  timeStart,
  timeEnd,
  legFromPrev,
  onTransportModeChange,
  onDragStart,
  onDrop,
  onRemove,
  onDetails,
  onLink,
  className,
}: PlaceCardProps) {
  return (
    <div className={cn("group", className)}>
      {legFromPrev && onTransportModeChange && (
        <div className="space-y-1.5 py-1 pl-14">
          <div className="flex flex-wrap items-center gap-1">
            {MODE_BUTTONS.map(({ mode, Icon, label }) => {
              const active = legFromPrev.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => onTransportModeChange(mode)}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface text-muted hover:bg-surface-muted"
                  )}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            {legFromPrev.minutes} min · {legFromPrev.distance}
          </p>
        </div>
      )}
      <div
        className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-muted"
        draggable
        onDragStart={onDragStart}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
          <span className="text-lg font-bold text-muted">{String.fromCodePoint(0x41 + index)}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">{place.reasons[0] || "Location"}</span>
            <span className="font-medium text-sm text-primary">{place.name}</span>
          </div>
          {timeStart && timeEnd && (
            <p className="text-xs text-muted mt-0.5">
              {timeStart} - {timeEnd}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onDetails}
            className="rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-surface-muted transition-colors"
          >
            Details
          </button>
          {place.website && (
            <button
              onClick={onLink}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-surface-muted transition-colors"
            >
              Link <ExternalLink size={10} />
            </button>
          )}
        </div>

        <button className="invisible text-muted cursor-grab group-hover:visible">
          <GripVertical size={16} />
        </button>
      </div>
    </div>
  );
}
