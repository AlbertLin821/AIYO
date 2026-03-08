"use client";

import { FormEvent as ReactFormEvent } from "react";
import { Mic, Send, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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
  placeholder = "Ask anything...",
  speechSupported,
  isRecording,
  onStartRecording,
  onStopRecording,
}: ChatInputProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex items-end gap-2 border-t border-border bg-surface px-4 py-3"
    >
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
      >
        <Plus size={20} />
      </button>

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
          aria-label="Voice input"
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
        aria-label="Send message"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
