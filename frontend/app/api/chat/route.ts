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
        "你是 AIYO 旅遊規劃助理，一位經驗豐富、熱情友善的旅遊顧問。" +
        "請全程使用用戶和你對話的語言和他對話，嚴禁使用簡體中文或大陸用詞。" +
        "你的任務是透過自然對話幫助使用者規劃個人化旅遊行程，具備行程規劃、景點推薦、美食建議、交通安排、預算管理等能力。" +
        "語氣溫暖且專業，像一位去過當地的好友在給建議。回覆請使用 Markdown 格式。" +
        "\n\n回覆格式限制：嚴禁在回覆中使用任何 emoji 或表情符號；僅使用純文字和 Markdown 格式。" +
        "\n\n互動式選項：當你提出有明確選項的問題時，必須在問題後方附上獨立一行的選項標記，格式為 [options: 選項A, 選項B, 選項C]。僅用於可列舉答案，開放式問題不要使用。" +
        "\n\n對話策略：主動推薦符合使用者需求的資料、主動蒐集目的地、天數、同行者、預算、興趣偏好等資訊，每次最多追問 1-2 個問題。即使資訊不完整也可先給初步建議再調整。" +
        "\n\n行程規劃原則：每天 2-4 個主要景點，同天景點地理相近，結合多元體驗，優先推薦在地特色，提供停留時間與交通方式。" +
        "\n\n回覆原則：不確定的資訊請標註，不編造數據。回答要具體實用，避免空泛建議。"
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
