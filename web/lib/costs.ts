export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type CostBreakdown = {
  transcriptionUsd: number;
  gradingUsd: number;
  totalUsd: number;
};

// Pricing snapshot checked against OpenAI's published model pages on 2026-07-17.
// Values are USD per minute for transcription and USD per million tokens for QA.
export const TRANSCRIPTION_USD_PER_MINUTE: Record<string, number> = {
  "whisper-1": 0.006,
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
};

export const QA_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5": { input: 1.25, output: 10 },
  "o3": { input: 2, output: 8 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.5": { input: 5, output: 30 },
};

export function transcriptionCost(model: string, seconds: number) {
  const rate = TRANSCRIPTION_USD_PER_MINUTE[model] ?? TRANSCRIPTION_USD_PER_MINUTE["gpt-4o-mini-transcribe"];
  return Math.max(0, seconds) / 60 * rate;
}

export function gradingCost(model: string, usage: TokenUsage) {
  const rate = QA_USD_PER_MILLION_TOKENS[model] ?? QA_USD_PER_MILLION_TOKENS["gpt-4o-mini"];
  return (Math.max(0, usage.promptTokens) * rate.input + Math.max(0, usage.completionTokens) * rate.output) / 1_000_000;
}

export function estimatedQaUsage(seconds: number): TokenUsage {
  const minutes = Math.max(0, seconds) / 60;
  return {
    promptTokens: Math.ceil(1_500 + minutes * 300),
    completionTokens: 900,
  };
}

export function estimatedSessionCost(transcriptionModel: string, qaModel: string, seconds: number): CostBreakdown {
  const transcriptionUsd = transcriptionCost(transcriptionModel, seconds);
  const gradingUsd = gradingCost(qaModel, estimatedQaUsage(seconds));
  return { transcriptionUsd, gradingUsd, totalUsd: transcriptionUsd + gradingUsd };
}

export function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
