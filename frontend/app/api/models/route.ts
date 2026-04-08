/** 網站僅允許使用的 Ollama 模型（與 gateway / ai-service 一致） */
const ALLOWED_MODELS = ["gemma4:26b", "gemma4:e4b"] as const;

export async function GET() {
  const selectedRaw = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
  const selected = ALLOWED_MODELS.includes(selectedRaw as (typeof ALLOWED_MODELS)[number])
    ? selectedRaw
    : "gemma4:e4b";

  return Response.json({
    models: ALLOWED_MODELS.map((name) => ({ name })),
    selected
  });
}
