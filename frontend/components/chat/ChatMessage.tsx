"use client";

import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/types/planner";
import { Sparkles, User } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
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
  const codeBlocks: string[] = [];
  const withCodePlaceholder = normalized.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
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
  return html;
}

export function ChatMessageComponent({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 animate-slide-up", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        isUser ? "bg-primary text-primary-foreground" : "bg-surface-muted text-primary"
      )}>
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-tr-md"
          : "bg-surface-muted text-primary rounded-tl-md"
      )}>
        <div
          dangerouslySetInnerHTML={{
            __html: markdownToSafeHtml(
              message.content || (isStreaming ? "..." : "")
            ),
          }}
        />
      </div>
    </div>
  );
}
