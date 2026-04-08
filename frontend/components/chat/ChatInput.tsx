"use client";

import { FormEvent as ReactFormEvent, useState, useRef, useEffect } from "react";
import { Mic, Send, Plus, MapPin, Calendar, DollarSign, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const quickActions = [
  { id: "destination", icon: MapPin, label: "設定目的地", prompt: "我想去 " },
  { id: "dates", icon: Calendar, label: "設定旅遊日期", prompt: "我想在 " },
  { id: "budget", icon: DollarSign, label: "設定預算", prompt: "我的預算大約 " },
  { id: "travelers", icon: Users, label: "設定旅伴人數", prompt: "我們一共 " },
];

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: ReactFormEvent<HTMLFormElement>) => void;
  loading?: boolean;
  placeholder?: string;
  speechSupported?: boolean;
  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  loading,
  placeholder = "輸入你的旅遊問題，例如「推薦東京三天兩夜行程」...",
  speechSupported,
  isRecording,
  onStartRecording,
  onStopRecording,
}: ChatInputProps) {
  const [showQuickActions, setShowQuickActions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowQuickActions(false);
      }
    }
    if (showQuickActions) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showQuickActions]);

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-end gap-2 border-t border-border bg-surface px-4 py-3"
    >
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
          onClick={() => setShowQuickActions((v) => !v)}
          aria-label="快速操作"
        >
          <Plus size={20} />
        </button>
        {showQuickActions && (
          <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-border bg-surface py-1 shadow-modal animate-fade-in">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-primary hover:bg-surface-muted transition-colors"
                onClick={() => {
                  onChange(action.prompt);
                  setShowQuickActions(false);
                }}
              >
                <action.icon size={16} className="text-muted" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-[44px] flex-1 items-center rounded-2xl border border-border bg-surface-muted px-4">
        <input
          id="chat-message-input"
          name="chat-message"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-primary placeholder:text-muted outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={loading}
          aria-label="輸入聊天訊息"
        />
      </div>

      {speechSupported && (
        <button
          type="button"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
            isRecording
              ? "bg-danger text-primary-foreground"
              : "text-muted hover:bg-surface-muted"
          )}
          disabled={loading}
          onMouseDown={onStartRecording}
          onMouseUp={onStopRecording}
          onMouseLeave={onStopRecording}
          onTouchStart={(e) => { e.preventDefault(); onStartRecording?.(); }}
          onTouchEnd={(e) => { e.preventDefault(); onStopRecording?.(); }}
          aria-label="語音輸入"
        >
          <Mic size={18} />
        </button>
      )}

      <button
        type="submit"
        disabled={loading || !value.trim()}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
          value.trim() && !loading
            ? "bg-primary text-primary-foreground"
            : "text-muted hover:bg-surface-muted"
        )}
        aria-label="傳送訊息"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
