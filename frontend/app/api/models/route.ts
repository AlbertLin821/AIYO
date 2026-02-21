type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

export async function GET() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const selected = process.env.OLLAMA_MODEL ?? "";

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    });

    if (!response.ok) {
      return Response.json({ models: selected ? [{ name: selected }] : [], selected });
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const names = Array.from(
      new Set((payload.models ?? []).map((item) => item.name).filter((name): name is string => Boolean(name)))
    );

    if (names.length === 0 && selected) {
      names.push(selected);
    }

    return Response.json({
      models: names.map((name) => ({ name })),
      selected: selected || names[0] || ""
    });
  } catch {
    return Response.json({ models: selected ? [{ name: selected }] : [], selected });
  }
}
