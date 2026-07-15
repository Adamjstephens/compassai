export const runtime = "nodejs";
export const maxDuration = 60;

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
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) {
      return jsonError("No recording file was received by CompassAi.", 400);
    }

    const form = new FormData();
    form.append("model", String(incoming.get("model") || "gpt-4o-mini-transcribe"));
    form.append("response_format", String(incoming.get("response_format") || "json"));
    form.append("file", file, file.name || "recording.wav");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.key}` },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) {
      return jsonError(`OpenAI transcription HTTP ${response.status}`, response.status, text.slice(0, 1000));
    }
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("CompassAi transcription relay failed before OpenAI returned a response.", 502, message);
  }
}
