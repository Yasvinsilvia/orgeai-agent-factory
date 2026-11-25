import type { DocumentChunk, RetrievalConfig, RetrievedChunk } from '../../src/types/forge.ts';
import type { ExtractedSegment } from './documentProcessor.ts';
import { BudgetTracker, embedTexts } from './gemini.ts';

export interface RetrievalMetadataFilter {
  document_names?: string[];
  file_types?: Array<'pdf' | 'docx' | 'txt' | 'csv'>;
}

function findCleanBoundaryEnd(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;
  const minEnd = Math.min(targetEnd, start + Math.max(120, Math.floor((targetEnd - start) * 0.6)));
  const window = text.slice(minEnd, targetEnd + 1);

  // Prefer paragraph break
  const paraRel = window.lastIndexOf('\n\n');
  if (paraRel !== -1) return minEnd + paraRel;

  // Prefer sentence break (. ! ?) followed by whitespace/newline
  const sentenceMatches = Array.from(window.matchAll(/[.!?](?=\s|\n|$)/g));
  if (sentenceMatches.length > 0) {
    const last = sentenceMatches[sentenceMatches.length - 1];
    if (typeof last.index === 'number') {
      return minEnd + last.index + 1;
    }
  }

  // Prefer single newline or space so we never split mid-word
  const nlRel = window.lastIndexOf('\n');
  if (nlRel !== -1) return minEnd + nlRel;
  const spaceRel = window.lastIndexOf(' ');
  if (spaceRel !== -1) return minEnd + spaceRel;

  return targetEnd;
}

export function buildChunksFromSegments(params: {
  agent_id: string;
  document_name: string;
  file_type: 'pdf' | 'docx' | 'txt' | 'csv';
  segments: ExtractedSegment[];
  chunk_size: number;
  chunk_overlap: number;
}): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const safeSize = Math.max(200, Math.min(2400, params.chunk_size || 700));
  const safeOverlap = Math.max(0, Math.min(Math.floor(safeSize / 2), params.chunk_overlap || 120));

  if (params.file_type === 'csv') {
    const rowsPerChunk = Math.max(1, Math.min(8, Math.floor(safeSize / 160)));
    for (let i = 0; i < params.segments.length; i += rowsPerChunk) {
      const slice = params.segments.slice(i, i + rowsPerChunk);
      const firstRow = slice[0].page_or_row;
      const lastRow = slice[slice.length - 1].page_or_row;
      const page_or_row = slice.length === 1 ? firstRow : `${firstRow}-${lastRow.replace('Row ', '')}`;
      const source_text = slice.map((s) => `${s.page_or_row}: ${s.text}`).join('\n');
      chunks.push({
        chunk_id: `${params.document_name}::chunk_${chunks.length + 1}`,
        agent_id: params.agent_id,
        document_name: params.document_name,
        file_type: params.file_type,
        page_or_row,
        source_text,
        char_count: source_text.length,
        ...(slice.some((s) => s.injection_sanitized) ? { injection_sanitized: true } : {}),
      });
    }
    return chunks;
  }

  let globalChunkIdx = 1;
  for (const seg of params.segments) {
    const text = seg.text;
    if (text.length <= safeSize) {
      chunks.push({
        chunk_id: `${params.document_name}::chunk_${globalChunkIdx++}`,
        agent_id: params.agent_id,
        document_name: params.document_name,
        file_type: params.file_type,
        page_or_row: seg.page_or_row,
        source_text: text,
        char_count: text.length,
        ...(seg.injection_sanitized ? { injection_sanitized: true } : {}),
      });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const rawEnd = Math.min(text.length, start + safeSize);
      const end = findCleanBoundaryEnd(text, start, rawEnd);
      const slice = text.slice(start, end).trim();
      if (slice.length > 0) {
        chunks.push({
          chunk_id: `${params.document_name}::chunk_${globalChunkIdx++}`,
          agent_id: params.agent_id,
          document_name: params.document_name,
          file_type: params.file_type,
          page_or_row: seg.page_or_row,
          source_text: slice,
          char_count: slice.length,
          ...(seg.injection_sanitized ? { injection_sanitized: true } : {}),
        });
      }
      if (end >= text.length) break;
      let nextStart = Math.max(start + 1, end - safeOverlap);
      // Snap nextStart forward to word boundary so overlap doesn't start mid-word
      if (nextStart > 0 && nextStart < text.length && !/\s/.test(text[nextStart - 1])) {
        const nextSpace = text.indexOf(' ', nextStart);
        if (nextSpace !== -1 && nextSpace < end) {
          nextStart = nextSpace + 1;
        }
      }
      start = nextStart;
    }
  }

  return chunks;
}

export async function indexChunksWithEmbeddings(
  chunks: DocumentChunk[],
  tracker?: BudgetTracker
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return [];
  const vectors = await embedTexts(
    chunks.map((c) => `${c.document_name} (${c.page_or_row})\n${c.source_text}`),
    tracker
  );
  if (!vectors) return chunks;
  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors[i],
  }));
}

/**
 * Ensures all chunks have real vector embeddings computed via Gemini Embedding API.
 * Only embeds chunks missing vectors so seeded demos and cached workspaces incur minimal cost.
 */
export async function ensureChunkEmbeddings(
  chunks: DocumentChunk[],
  tracker?: BudgetTracker
): Promise<{ chunks: DocumentChunk[]; updated: boolean }> {
  const missingIndices: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!Array.isArray(chunks[i].embedding) || chunks[i].embedding!.length === 0) {
      missingIndices.push(i);
    }
  }
  if (missingIndices.length === 0) {
    return { chunks, updated: false };
  }

  const missingTexts = missingIndices.map(
    (idx) => `${chunks[idx].document_name} (${chunks[idx].page_or_row})\n${chunks[idx].source_text}`
  );
  const vectors = await embedTexts(missingTexts, tracker);
  if (!vectors) {
    return { chunks, updated: false };
  }

  const cloned = [...chunks];
  missingIndices.forEach((chunkIdx, vecIdx) => {
    if (vectors[vecIdx] && vectors[vecIdx].length > 0) {
      cloned[chunkIdx] = { ...cloned[chunkIdx], embedding: vectors[vecIdx] };
    }
  });
  return { chunks: cloned, updated: true };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'of', 'to', 'in',
  'for', 'with', 'what', 'how', 'are', 'do', 'does', 'can', 'we', 'our', 'if',
  'about', 'from', 'by', 'be', 'this', 'that', 'it', 'as', 'will', 'when',
  'where', 'who', 'should', 'would', 'could', 'they', 'their', 'there', 'than',
  'into', 'all', 'any', 'has', 'have', 'had', 'not', 'but', 'my', 'your',
]);

function extractKeyEntities(text: string): string[] {
  const matches =
    text.match(/\b(?:[A-Z]{2,}-\d+|\d+(?:\.\d+)?%?|\$\d+(?:,\d{3})*(?:\.\d+)?)\b/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase().replace(/,/g, ''))));
}

function computeIdfMap(chunks: DocumentChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  const N = Math.max(1, chunks.length);
  for (const c of chunks) {
    const unique = new Set(tokenize(`${c.document_name} ${c.source_text}`));
    for (const tok of unique) {
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [tok, count] of df.entries()) {
    idf.set(tok, Math.log(1 + (N - count + 0.5) / (count + 0.5)));
  }
  return idf;
}

function bm25LexicalScore(
  query: string,
  docText: string,
  idfMap: Map<string, number>,
  avgDocLen: number
): number {
  const qTokens = tokenize(query).filter((t) => !STOPWORDS.has(t));
  if (qTokens.length === 0) return 0;

  const dTokens = tokenize(docText);
  const dLower = docText.toLowerCase().replace(/,/g, '');
  const tf = new Map<string, number>();
  for (const t of dTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  const k1 = 1.2;
  const b = 0.65;
  const dl = Math.max(1, dTokens.length);
  let scoreSum = 0;
  let maxPossible = 0;

  for (const qt of qTokens) {
    const idf = idfMap.get(qt) ?? 1.0;
    maxPossible += idf * (k1 + 1);
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) {
      const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (dl / Math.max(1, avgDocLen))));
      scoreSum += idf * tfNorm;
    } else if (qt.length >= 4 && dLower.includes(qt)) {
      scoreSum += idf * 0.6;
    }
  }

  let baseScore = maxPossible > 0 ? Math.min(1, scoreSum / maxPossible) : 0;

  // Exact entity / SKU / numeric / currency match boost
  const entities = extractKeyEntities(query);
  if (entities.length > 0) {
    const entityHits = entities.filter((e) => dLower.includes(e)).length;
    baseScore = Math.min(1, baseScore + 0.22 * (entityHits / entities.length));
  }

  return baseScore;
}

export async function retrieveRelevantChunks(params: {
  query: string;
  chunks: DocumentChunk[];
  config: RetrievalConfig;
  tracker?: BudgetTracker;
  useEmbeddings?: boolean;
  metadataFilter?: RetrievalMetadataFilter;
}): Promise<RetrievedChunk[]> {
  let pool = params.chunks;
  if (params.metadataFilter?.document_names && params.metadataFilter.document_names.length > 0) {
    const allowedDocs = new Set(params.metadataFilter.document_names.map((d) => d.toLowerCase()));
    pool = pool.filter((c) => allowedDocs.has(c.document_name.toLowerCase()));
  }
  if (params.metadataFilter?.file_types && params.metadataFilter.file_types.length > 0) {
    const allowedTypes = new Set(params.metadataFilter.file_types);
    pool = pool.filter((c) => allowedTypes.has(c.file_type));
  }
  if (pool.length === 0) return [];

  let workingPool = pool;
  if (params.useEmbeddings !== false) {
    const ensured = await ensureChunkEmbeddings(pool, params.tracker);
    workingPool = ensured.chunks;
  }

  let queryEmbedding: number[] | null = null;
  const hasChunkEmbeddings = workingPool.some(
    (c) => Array.isArray(c.embedding) && c.embedding.length > 0
  );
  if (params.useEmbeddings !== false && hasChunkEmbeddings) {
    const vecs = await embedTexts([params.query], params.tracker);
    if (vecs && vecs[0]) {
      queryEmbedding = vecs[0];
    }
  }

  const idfMap = computeIdfMap(workingPool);
  const avgDocLen =
    workingPool.reduce((s, c) => s + tokenize(c.source_text).length, 0) /
    Math.max(1, workingPool.length);

  // Stage 1: Hybrid Semantic + BM25-IDF + Entity Scoring
  const scored = workingPool.map((chunk) => {
    const lex = bm25LexicalScore(
      params.query,
      `${chunk.document_name} ${chunk.source_text}`,
      idfMap,
      avgDocLen
    );
    let sem = 0;
    if (queryEmbedding && chunk.embedding && chunk.embedding.length === queryEmbedding.length) {
      sem = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
    }
    const hybridScore = queryEmbedding ? 0.62 * sem + 0.38 * lex : lex;
    return {
      chunk,
      retrieved: {
        chunk_id: chunk.chunk_id,
        document_name: chunk.document_name,
        page_or_row: chunk.page_or_row,
        source_text: chunk.source_text,
        similarity_score: Number(hybridScore.toFixed(4)),
      } satisfies RetrievedChunk,
    };
  });

  scored.sort((a, b) => b.retrieved.similarity_score - a.retrieved.similarity_score);

  const threshold = params.config.similarity_threshold ?? 0.25;
  const topK = Math.max(1, Math.min(12, params.config.top_k || 4));
  const candidates = scored.filter((s) => s.retrieved.similarity_score >= threshold);

  if (candidates.length === 0) {
    return scored
      .filter((s) => s.retrieved.similarity_score >= 0.12)
      .slice(0, Math.min(2, topK))
      .map((s) => s.retrieved);
  }

  // Stage 2: Multi-document Diversity Reranking (MMR-like per-doc saturation penalty)
  const poolLimit = Math.min(candidates.length, Math.max(topK * 3, 12));
  const rerankPool = candidates.slice(0, poolLimit);
  const selected: RetrievedChunk[] = [];
  const docSelectionCounts = new Map<string, number>();

  while (selected.length < topK && rerankPool.length > 0) {
    let bestIdx = 0;
    let bestAdjusted = -Infinity;

    for (let i = 0; i < rerankPool.length; i++) {
      const cand = rerankPool[i];
      const docCount = docSelectionCounts.get(cand.retrieved.document_name) ?? 0;
      // Mild diversity penalty if a single doc already dominates top results while other docs clear threshold
      const diversityPenalty = docCount * 0.045;
      const adjusted = cand.retrieved.similarity_score - diversityPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = i;
      }
    }

    const [chosen] = rerankPool.splice(bestIdx, 1);
    selected.push(chosen.retrieved);
    docSelectionCounts.set(
      chosen.retrieved.document_name,
      (docSelectionCounts.get(chosen.retrieved.document_name) ?? 0) + 1
    );
  }

  return selected;
}
