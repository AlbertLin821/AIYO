import { NextRequest } from "next/server";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  sessionId?: string;
  message?: string;
  messages?: ChatMessage[];
  model?: string;
};

type OllamaChunk = {
  done?: boolean;
  message?: {
    content?: string;
    role?: string;
  };
  error?: string;
};

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  };
}

function toOllamaMessages(messages: ChatMessage[], message: string): ChatMessage[] {
  const validHistory = messages.filter((item) => item.content.trim().length > 0);
  if (validHistory.length === 0 || validHistory[validHistory.length - 1].content !== message) {
    validHistory.push({ role: "user", content: message });
  }
  return [
    {
      role: "system",
      content:
        "你是 AIYO 旅遊助理。你必須全程使用繁體中文回覆，不可使用簡體中文。回覆內容需清楚、實用，必要時可使用 Markdown 格式。"
    },
    ...validHistory.slice(-20)
  ];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim() ?? "";

    if (!message) {
      return Response.json({ error: "請輸入聊天內容。" }, { status: 400 });
    }

    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const model = body.model?.trim() || process.env.OLLAMA_MODEL || "qwen3:8b";
    const messages = toOllamaMessages(body.messages ?? [], message);

    const upstream = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages
      })
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        {
          error: detail || `無法連線模型服務（${upstream.status}）。`
        },
        { status: 502 }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const text = line.trim();
              if (!text) {
                continue;
              }
              let payload: OllamaChunk;
              try {
                payload = JSON.parse(text) as OllamaChunk;
              } catch {
                continue;
              }

              if (payload.error) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ error: payload.error })}\n\n`)
                );
                continue;
              }

              const token = payload.message?.content ?? "";
              if (token) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
                );
              }

              if (payload.done) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
              }
            }
          }

          if (buffer.trim()) {
            try {
              const payload = JSON.parse(buffer.trim()) as OllamaChunk;
              const token = payload.message?.content ?? "";
              if (token) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
                );
              }
            } catch {
              // Ignore malformed trailing chunk.
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "模型回應中斷。";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
          );
        } finally {
          controller.close();
          reader.releaseLock();
        }
      }
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "聊天請求失敗。";
    return Response.json({ error: message }, { status: 500 });
  }
}
