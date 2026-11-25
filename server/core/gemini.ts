import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import path from 'path';

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is missing or unconfigured. Please configure GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function loadPromptTemplate(filename: string): string {
  const promptPath = path.resolve(process.cwd(), 'prompts', filename);
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf-8');
  }
  return '';
}

const LLM_INPUT_COST_PER_M = 0.15;
const LLM_OUTPUT_COST_PER_M = 0.6;
const EMBEDDING_COST_PER_M = 0.025;

export interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export class BudgetTracker {
  total_llm_calls = 0;
  total_embedding_calls = 0;
  total_latency_ms = 0;
  estimated_tokens = 0;
  input_tokens = 0;
  output_tokens = 0;
  embedding_tokens = 0;
  estimated_cost_usd = 0;
  early_stopped = false;
  stop_reason?: string;

  recordLlm(
    promptChars: number,
    outputChars: number,
    latencyMs: number,
    usage?: UsageMetadataLike
  ) {
    this.total_llm_calls += 1;
    this.total_latency_ms += latencyMs;
    const inTok =
      typeof usage?.promptTokenCount === 'number' && usage.promptTokenCount > 0
        ? usage.promptTokenCount
        : Math.ceil(promptChars / 4);
    const outTok =
      typeof usage?.candidatesTokenCount === 'number' && usage.candidatesTokenCount > 0
        ? usage.candidatesTokenCount
        : Math.ceil(outputChars / 4);
    const totTok =
      typeof usage?.totalTokenCount === 'number' && usage.totalTokenCount > 0
        ? usage.totalTokenCount
        : inTok + outTok;

    this.input_tokens += inTok;
    this.output_tokens += outTok;
    this.estimated_tokens += totTok;
    this.estimated_cost_usd +=
      (inTok / 1_000_000) * LLM_INPUT_COST_PER_M +
      (outTok / 1_000_000) * LLM_OUTPUT_COST_PER_M;
  }

  recordEmbedding(charCount: number, latencyMs: number, actualTokens?: number) {
    this.total_embedding_calls += 1;
    this.total_latency_ms += latencyMs;
    const tok =
      typeof actualTokens === 'number' && actualTokens > 0
        ? actualTokens
        : Math.ceil(charCount / 4);
    this.embedding_tokens += tok;
    this.input_tokens += tok;
    this.estimated_tokens += tok;
    this.estimated_cost_usd += (tok / 1_000_000) * EMBEDDING_COST_PER_M;
  }

  toJSON() {
    const totalCalls = this.total_llm_calls + this.total_embedding_calls;
    return {
      total_llm_calls: this.total_llm_calls,
      total_embedding_calls: this.total_embedding_calls,
      total_latency_ms: this.total_latency_ms,
      avg_latency_ms: totalCalls > 0 ? Math.round(this.total_latency_ms / totalCalls) : 0,
      estimated_tokens: this.estimated_tokens,
      input_tokens: this.input_tokens,
      output_tokens: this.output_tokens,
      estimated_cost_usd: Number(this.estimated_cost_usd.toFixed(6)),
      early_stopped: this.early_stopped,
      stop_reason: this.stop_reason,
    };
  }
}

export async function withGeminiRetry<T>(
  fn: (useFallbackModel: boolean) => Promise<T>,
  maxRetries = 4
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const useFallback = attempt >= maxRetries - 1 && lastErr != null && isTransientOverload(lastErr);
      return await fn(useFallback);
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('API_KEY') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('403') ||
        msg.includes('INVALID_ARGUMENT')
      ) {
        throw err;
      }
      if (attempt < maxRetries) {
        const base = isTransientOverload(err) ? 1400 : 600;
        const jitter = Math.floor(Math.random() * 400);
        await new Promise((r) => setTimeout(r, base * Math.pow(1.8, attempt) + jitter));
      }
    }
  }
  throw lastErr;
}

function isTransientOverload(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand')
  );
}

export async function generateText(params: {
  systemInstruction?: string;
  prompt: string;
  tracker?: BudgetTracker;
  lowThinking?: boolean;
}): Promise<string> {
  const ai = getGeminiClient();
  const start = Date.now();
  const response = await withGeminiRetry((useFallback) =>
    ai.models.generateContent({
      model: useFallback ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen',
      contents: params.prompt,
      config: {
        ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
        ...(params.lowThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    })
  );
  const text = (response.text ?? '').trim();
  params.tracker?.recordLlm(
    (params.systemInstruction?.length ?? 0) + params.prompt.length,
    text.length,
    Date.now() - start,
    response.usageMetadata as UsageMetadataLike | undefined
  );
  return text;
}

export async function generateStructuredJson<T>(params: {
  systemInstruction?: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  tracker?: BudgetTracker;
  lowThinking?: boolean;
}): Promise<T> {
  const ai = getGeminiClient();
  return withGeminiRetry(async (useFallback) => {
    const start = Date.now();
    const response = await ai.models.generateContent({
      model: useFallback ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen',
      contents: params.prompt,
      config: {
        ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
        responseMimeType: 'application/json',
        responseSchema: params.responseSchema,
        ...(params.lowThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });
    const raw = (response.text ?? '{}').trim();
    params.tracker?.recordLlm(
      (params.systemInstruction?.length ?? 0) + params.prompt.length,
      raw.length,
      Date.now() - start,
      response.usageMetadata as UsageMetadataLike | undefined
    );
    return JSON.parse(raw) as T;
  });
}

export async function embedTexts(
  texts: string[],
  tracker?: BudgetTracker
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const ai = getGeminiClient();
    const batchSize = 20;
    const allVectors: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const start = Date.now();
      const res = await withGeminiRetry(() =>
        ai.models.embedContent({
          model: 'gemini-embedding-2',
          contents: slice,
        })
      );
      const charTotal = slice.reduce((sum, s) => sum + s.length, 0);
      tracker?.recordEmbedding(charTotal, Date.now() - start);
      const vecs = (res.embeddings ?? []).map((e) => e.values ?? []);
      if (vecs.length !== slice.length) {
        return null;
      }
      allVectors.push(...vecs);
    }
    return allVectors;
  } catch {
    return null;
  }
}
