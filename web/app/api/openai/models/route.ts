export const runtime = "nodejs";
export const maxDuration = 30;

function apiKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  return key.startsWith("sk-") ? key : "";
}

export async function GET(request: Request) {
  const key = apiKey(request);
  if (!key) {
    return Response.json({ error: "Missing or invalid OpenAI API key." }, { status: 401 });
  }
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      return Response.json(
        { error: `OpenAI models HTTP ${response.status}`, details: text.slice(0, 1000) },
        { status: response.status },
      );
    }
    const payload = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const models = (payload.data ?? [])
      .map((model) => String(model.id ?? ""))
      .filter(Boolean)
      .sort();
    return Response.json({ models }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: "CompassAi could not retrieve available OpenAI models.", details: message }, { status: 502 });
  }
}
