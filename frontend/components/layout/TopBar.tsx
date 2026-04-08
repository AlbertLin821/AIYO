"use client";

import * as React from "react";
import { ChevronDown, Users, UserPlus, Link2, ExternalLink, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";

interface TopBarProps {
  tripName?: string;
  destination?: string;
  dates?: string;
  travelers?: number;
  budget?: string;
  onInvite?: () => void;
  onCreateTrip?: () => void;
  onEditDestination?: () => void;
  onEditDates?: () => void;
  onEditTravelers?: () => void;
  onEditBudget?: () => void;
  className?: string;
}

export function TopBar({
  tripName,
  destination,
  dates,
  travelers,
  budget,
  onInvite,
  onCreateTrip,
  onEditDestination,
  onEditDates,
  onEditTravelers,
  onEditBudget,
  className,
}: TopBarProps) {
  const [tripMenuOpen, setTripMenuOpen] = React.useState(false);
  const tripMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tripMenuRef.current && !tripMenuRef.current.contains(e.target as Node)) {
        setTripMenuOpen(false);
      }
    }
    if (tripMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [tripMenuOpen]);

  const handleEditDestination = onEditDestination ?? (() => {});
  const handleEditDates = onEditDates ?? (() => {});
  const handleEditTravelers = onEditTravelers ?? (() => {});
  const handleEditBudget = onEditBudget ?? (() => {});

  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between border-b border-border bg-surface px-4",
        className
      )}
    >
      <div className="flex items-center gap-2 relative" ref={tripMenuRef}>
        {tripName && (
          <>
            <button
              type="button"
              onClick={() => setTripMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-70 transition-opacity"
            >
              <MapPin size={16} className="shrink-0 text-travel-ocean" aria-hidden />
              {tripName}
              <ChevronDown size={14} />
            </button>
            {tripMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-btn border border-border bg-surface py-1 shadow-modal">
                <button
                  type="button"
                  onClick={() => {
                    onInvite?.();
                    setTripMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-surface-muted"
                >
                  <Link2 size={14} />
                  Copy share link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") window.open(window.location.href, "_blank");
                    setTripMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-surface-muted"
                >
                  <ExternalLink size={14} />
                  Open in new tab
                </button>
              </div>
            )}
          </>
        )}
        {!tripName && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <MapPin size={16} className="shrink-0 text-travel-ocean/70" aria-hidden />
            New chat
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {destination && (
          <Tag className="cursor-pointer" onClick={handleEditDestination}>
            {destination}
          </Tag>
        )}
        {!destination && (
          <button
            type="button"
            onClick={handleEditDestination}
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            Where
          </button>
        )}

        {dates && (
          <Tag className="cursor-pointer" onClick={handleEditDates}>
            {dates}
          </Tag>
        )}
        {!dates && (
          <button
            type="button"
            onClick={handleEditDates}
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            When
          </button>
        )}

        <button
          type="button"
          onClick={handleEditTravelers}
          className="flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors"
        >
          <Users size={14} />
          {travelers ? `${travelers} travelers` : "Who"}
        </button>

        {budget && (
          <Tag className="cursor-pointer" onClick={handleEditBudget}>
            {budget}
          </Tag>
        )}
        {!budget && (
          <button
            type="button"
            onClick={handleEditBudget}
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            Budget
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onInvite}>
          <UserPlus size={14} className="mr-1.5" />
          Invite
        </Button>
        <Button type="button" size="sm" onClick={onCreateTrip}>
          Create a trip
        </Button>
      </div>
    </header>
  );
}
