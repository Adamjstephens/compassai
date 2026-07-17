export const runtime = "nodejs";
export const maxDuration = 300;

type KeyResult = { key: string } | { error: string };

function openAiKey(request: Request): KeyResult {
  const header = request.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("sk-")) {
    return { error: "Missing or invalid OpenAI API key. Save the key in Settings and try again." };
  }
  return { key };
}

function jsonError(message: string, status = 500, details = "") {
  return Response.json({ error: message, details }, { status });
}

export async function POST(request: Request) {
  const auth = openAiKey(request);
  if ("error" in auth) return jsonError(auth.error, 401);

  try {
    const body = await request.text();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.key}`,
        "Content-Type": "application/json",
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      return jsonError(`OpenAI QA HTTP ${response.status}`, response.status, text.slice(0, 1000));
    }
    const payload = JSON.parse(text) as { model?: string };
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
        "x-compassai-actual-model": String(payload.model ?? ""),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("CompassAi QA relay failed before OpenAI returned a response.", 502, message);
  }
}
