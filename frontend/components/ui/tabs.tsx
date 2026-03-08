"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: "default" | "pill";
  className?: string;
}

export function Tabs({ items, activeId, onChange, variant = "default", className }: TabsProps) {
  if (variant === "pill") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-btn px-4 py-2 text-sm font-medium transition-colors",
              activeId === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:bg-surface-muted"
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className="ml-1 text-xs opacity-70">{item.count}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-6 border-b border-border", className)}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "relative flex items-center gap-1.5 pb-3 text-sm font-medium transition-colors",
            activeId === item.id
              ? "text-primary"
              : "text-muted hover:text-primary"
          )}
        >
          {item.icon}
          {item.label}
          {item.count !== undefined && (
            <span className="text-xs text-muted">{item.count}</span>
          )}
          {activeId === item.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}
