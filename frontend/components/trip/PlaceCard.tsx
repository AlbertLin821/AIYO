"use client";

import { MoreHorizontal, ExternalLink, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Place } from "@/types/planner";

interface PlaceCardProps {
  place: Place;
  index: number;
  timeStart?: string;
  timeEnd?: string;
  distanceFromPrev?: string;
  onDragStart?: () => void;
  onDrop?: () => void;
  onRemove?: () => void;
  onDetails?: () => void;
  onLink?: () => void;
  className?: string;
}

export function PlaceCard({
  place,
  index,
  timeStart,
  timeEnd,
  distanceFromPrev,
  onDragStart,
  onDrop,
  onRemove,
  onDetails,
  onLink,
  className,
}: PlaceCardProps) {
  return (
    <div className={cn("group", className)}>
      {distanceFromPrev && (
        <div className="flex items-center gap-2 py-1 pl-14">
          <span className="text-xs text-muted">{distanceFromPrev}</span>
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
