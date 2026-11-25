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

export class BudgetTracker {
  total_llm_calls = 0;
  total_embedding_calls = 0;
  total_latency_ms = 0;
  estimated_tokens = 0;
  early_stopped = false;
  stop_reason?: string;

  recordLlm(promptChars: number, outputChars: number, latencyMs: number) {
    this.total_llm_calls += 1;
    this.total_latency_ms += latencyMs;
    this.estimated_tokens += Math.ceil((promptChars + outputChars) / 4);
  }

  recordEmbedding(charCount: number, latencyMs: number) {
    this.total_embedding_calls += 1;
    this.total_latency_ms += latencyMs;
    this.estimated_tokens += Math.ceil(charCount / 4);
  }

  toJSON() {
    return {
      total_llm_calls: this.total_llm_calls,
      total_embedding_calls: this.total_embedding_calls,
      total_latency_ms: this.total_latency_ms,
      estimated_tokens: this.estimated_tokens,
      early_stopped: this.early_stopped,
      stop_reason: this.stop_reason,
    };
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API_KEY') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

export async function generateText(params: {
  systemInstruction?: string;
  prompt: string;
  tracker?: BudgetTracker;
  lowThinking?: boolean;
}): Promise<string> {
  const ai = getGeminiClient();
  const start = Date.now();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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
    Date.now() - start
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
  const start = Date.now();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: params.prompt,
      config: {
        ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
        responseMimeType: 'application/json',
        responseSchema: params.responseSchema,
        ...(params.lowThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    })
  );
  const raw = (response.text ?? '{}').trim();
  params.tracker?.recordLlm(
    (params.systemInstruction?.length ?? 0) + params.prompt.length,
    raw.length,
    Date.now() - start
  );
  return JSON.parse(raw) as T;
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
      const res = await withRetry(() =>
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
