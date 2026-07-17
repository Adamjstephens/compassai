import assert from "node:assert/strict";
import test from "node:test";
import { POST as relayChat } from "../app/api/openai/chat/route.ts";
import { GET as listModels } from "../app/api/openai/models/route.ts";

test("model discovery returns the models available to the supplied API key", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (_input, init) => {
    authorization = String(init?.headers && (init.headers as Record<string, string>).Authorization);
    return Response.json({ data: [{ id: "gpt-5-mini" }, { id: "gpt-4o-mini" }] });
  };
  try {
    const response = await listModels(new Request("http://localhost/api/openai/models", {
      headers: { Authorization: "Bearer sk-test-model-key" },
    }));
    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer sk-test-model-key");
    assert.deepEqual((await response.json()).models, ["gpt-4o-mini", "gpt-5-mini"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat relay exposes the actual model returned by OpenAI", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedModel = "";
  globalThis.fetch = async (_input, init) => {
    forwardedModel = JSON.parse(String(init?.body)).model;
    return Response.json({
      id: "chatcmpl-test",
      model: "gpt-5-mini-2025-08-07",
      choices: [{ message: { content: "OK" } }],
    });
  };
  try {
    const response = await relayChat(new Request("http://localhost/api/openai/chat", {
      method: "POST",
      headers: { Authorization: "Bearer sk-test-model-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5-mini", messages: [{ role: "user", content: "test" }] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(forwardedModel, "gpt-5-mini");
    assert.equal(response.headers.get("x-compassai-actual-model"), "gpt-5-mini-2025-08-07");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model discovery rejects a missing API key without contacting OpenAI", async () => {
  const originalFetch = globalThis.fetch;
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    return Response.json({});
  };
  try {
    const response = await listModels(new Request("http://localhost/api/openai/models"));
    assert.equal(response.status, 401);
    assert.equal(contacted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
