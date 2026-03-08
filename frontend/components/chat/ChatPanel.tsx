"use client";

import { FormEvent as ReactFormEvent, useRef, useEffect } from "react";
import type { ChatMessage, ToolCallSummary } from "@/types/planner";
import { ChatMessageComponent } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { Sparkles } from "lucide-react";

interface ChatPanelProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: (e: ReactFormEvent<HTMLFormElement>) => void;
  chatLoading: boolean;
  chatError: string | null;
  chatDegraded: boolean;
  toolCallSummaries: ToolCallSummary[];
  speechSupported: boolean;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  greeting?: string;
}

export function ChatPanel({
  messages,
  chatInput,
  onChatInputChange,
  onSubmit,
  chatLoading,
  chatError,
  chatDegraded,
  toolCallSummaries,
  speechSupported,
  isRecording,
  onStartRecording,
  onStopRecording,
  greeting = "Where to today?",
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-4 pt-8">
            <h1 className="text-page-title text-primary">{greeting}</h1>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                <Sparkles size={14} className="text-primary" />
              </div>
              <p className="text-sm leading-relaxed text-muted">
                Hey there, I&apos;m here to assist you in planning your experience.
                Ask me anything travel related.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((message, index) => (
            <ChatMessageComponent
              key={`${message.role}-${index}`}
              message={message}
              isStreaming={chatLoading && index === messages.length - 1 && message.role === "assistant"}
            />
          ))}
        </div>

        {chatDegraded && (
          <p className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent-dark">
            Short-term memory mode active. Long-term preferences may not be fully applied.
          </p>
        )}

        {toolCallSummaries.length > 0 && (
          <div className="mt-3 rounded-lg border border-border p-3 text-xs">
            <p className="mb-2 font-medium text-primary">Tools used</p>
            <div className="space-y-1">
              {toolCallSummaries.map((item, index) => (
                <div key={`${item.tool ?? "tool"}-${index}`} className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1">
                  <span className="font-medium">{item.tool ?? "unknown"}</span>
                  <span className={item.ok ? "text-success" : "text-danger"}>
                    {item.ok ? "OK" : "Failed"}
                  </span>
                  {item.source && <span className="text-muted">{item.source}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {chatError && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {chatError}
          </p>
        )}
      </div>

      <div className="text-center text-xs text-muted pb-1">
        AIYO can make mistakes. Check important info.
      </div>

      <ChatInput
        value={chatInput}
        onChange={onChatInputChange}
        onSubmit={onSubmit}
        loading={chatLoading}
        speechSupported={speechSupported}
        isRecording={isRecording}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
      />
    </div>
  );
}
