"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/types/planner";
import { Sparkles, User } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  disableQuickReplies?: boolean;
  /** 所有選項組皆有選擇後自動回傳已選選項 */
  onOptionsSubmit?: (options: string[]) => void;
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
    .replace(/`([^`]+)`/g, '<code class="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="underline text-primary hover:opacity-70">$1</a>'
    );
}

export function markdownToSafeHtml(markdown: string): string {
  const normalized = escapeHtml(markdown.replace(/\r\n/g, "\n"));
  const quickReplyBlocks: string[] = [];
  const withQuickReplyPlaceholder = normalized.replace(/\[options:\s*(.+?)\]/g, (_, rawOptions: string) => {
    const hasPipeDelimiter = /[|｜]/.test(rawOptions);
    const options = (hasPipeDelimiter
      ? rawOptions.split(/\s*[|｜]\s*/)
      : rawOptions.split(/,\s+/))
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (options.length === 0) {
      return "";
    }
    const buttons = options
      .map((option) => {
        const escapedOption = escapeHtml(option);
        return `<button type="button" class="chat-quick-reply-btn mr-1.5 mb-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-xs transition-colors hover:bg-surface-muted" data-option="${escapedOption}" aria-pressed="false">${escapedOption}</button>`;
      })
      .join("");
    const html = `<div class="chat-quick-replies" data-quick-replies="true">${buttons}</div>`;
    const token = `@@QUICK_REPLY_BLOCK_${quickReplyBlocks.length}@@`;
    quickReplyBlocks.push(html);
    return token;
  });
  const codeBlocks: string[] = [];
  const withCodePlaceholder = withQuickReplyPlaceholder.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langText = lang ? `<div class="mb-1 text-xs text-muted">${lang}</div>` : "";
    const html = `<pre class="my-2 overflow-auto rounded-lg bg-primary p-3 text-primary-foreground text-sm"><code>${langText}${code.trim()}</code></pre>`;
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(html);
    return token;
  });

  const lines = withCodePlaceholder.split("\n");
  const parts: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) { parts.push("</ul>"); inUl = false; }
    if (inOl) { parts.push("</ol>"); inOl = false; }
  };

  for (const line of lines) {
    const text = line.trim();
    if (!text) { closeLists(); continue; }
    if (text.startsWith("@@CODE_BLOCK_")) { closeLists(); parts.push(text); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      parts.push(`<h${level} class="my-1 font-semibold">${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(text);
    if (ordered) {
      if (inUl) { parts.push("</ul>"); inUl = false; }
      if (!inOl) { parts.push('<ol class="my-1 list-decimal pl-5">'); inOl = true; }
      parts.push(`<li>${formatInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(text);
    if (unordered) {
      if (inOl) { parts.push("</ol>"); inOl = false; }
      if (!inUl) { parts.push('<ul class="my-1 list-disc pl-5">'); inUl = true; }
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
  quickReplyBlocks.forEach((item, index) => {
    html = html.replace(`@@QUICK_REPLY_BLOCK_${index}@@`, item);
  });
  return html;
}

export function ChatMessageComponent({
  message,
  isStreaming,
  disableQuickReplies,
  onOptionsSubmit,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const contentRef = useRef<HTMLDivElement>(null);
  const [quickReplyAnswered, setQuickReplyAnswered] = useState(false);
  const quickReplyDisabled = Boolean(disableQuickReplies || isStreaming || quickReplyAnswered);
  const messageHtml = useMemo(() => markdownToSafeHtml(message.content || ""), [message.content]);

  useEffect(() => {
    setQuickReplyAnswered(false);
  }, [message.content]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }
    const allGroups = container.querySelectorAll<HTMLElement>("[data-quick-replies='true']");
    allGroups.forEach((group) => {
      if (quickReplyDisabled) {
        group.classList.add("chat-quick-replies-disabled");
      } else {
        group.classList.remove("chat-quick-replies-disabled");
      }
      group.querySelectorAll<HTMLButtonElement>(".chat-quick-reply-btn").forEach((btn) => {
        btn.disabled = quickReplyDisabled;
      });
    });
  }, [messageHtml, quickReplyDisabled]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (quickReplyDisabled) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>(".chat-quick-reply-btn");
      if (!button || !container.contains(button)) {
        return;
      }
      const option = (button.dataset.option || button.textContent || "").trim();
      if (!option) {
        return;
      }
      button.classList.toggle("chat-quick-reply-selected");
      button.setAttribute("aria-pressed", button.classList.contains("chat-quick-reply-selected") ? "true" : "false");

      const allGroups = container.querySelectorAll<HTMLElement>("[data-quick-replies='true']");
      if (allGroups.length === 0) {
        return;
      }
      const everyGroupHasSelection = Array.from(allGroups).every(
        (group) => group.querySelector(".chat-quick-reply-btn.chat-quick-reply-selected") !== null
      );
      if (!everyGroupHasSelection) {
        return;
      }
      const allSelected = Array.from(allGroups).flatMap((group) =>
        Array.from(group.querySelectorAll<HTMLButtonElement>(".chat-quick-reply-btn.chat-quick-reply-selected"))
          .map((btn) => (btn.dataset.option || btn.textContent || "").trim())
          .filter(Boolean)
      );
      if (allSelected.length > 0) {
        setQuickReplyAnswered(true);
        onOptionsSubmit?.(allSelected);
      }
    };
    container.addEventListener("click", handleClick);
    return () => {
      container.removeEventListener("click", handleClick);
    };
  }, [onOptionsSubmit, quickReplyDisabled]);

  return (
    <div className={cn("flex gap-3 animate-slide-up", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm",
        isUser ? "bg-primary text-primary-foreground" : "bg-gradient-to-br from-primary/10 to-primary/5 text-primary ring-1 ring-primary/10"
      )}>
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
        isUser
          ? "bg-primary text-primary-foreground rounded-tr-md"
          : "bg-surface-muted/80 text-primary rounded-tl-md border border-border/30"
      )}>
        {isStreaming && !message.content ? (
          <div className="flex items-center gap-2 py-1" aria-label="AI 正在思考">
            <div className="flex gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50" style={{ animationDelay: "0ms" }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50" style={{ animationDelay: "150ms" }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-xs text-muted">思考中...</span>
          </div>
        ) : (
          <div
            ref={contentRef}
            className={cn("chat-message-content", isStreaming && "streaming-text")}
            dangerouslySetInnerHTML={{
              __html: messageHtml,
            }}
          />
        )}
      </div>
    </div>
  );
}
