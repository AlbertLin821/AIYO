"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

interface MapViewProps {
  className?: string;
  onMapReady?: (map: google.maps.Map) => void;
  mapError?: string | null;
  mapReady?: boolean;
}

export interface MapViewHandle {
  containerRef: HTMLDivElement | null;
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(
  function MapView({ className, mapError, mapReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      get containerRef() {
        return containerRef.current;
      },
    }));

    return (
      <div className={cn("relative h-full w-full overflow-hidden", className)}>
        <div ref={containerRef} className="h-full w-full" />

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
      </div>
    );
  }
);
