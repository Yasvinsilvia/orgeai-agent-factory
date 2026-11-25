import type { DocumentChunk, RetrievalConfig, RetrievedChunk } from '../../src/types/forge.ts';
import type { ExtractedSegment } from './documentProcessor.ts';
import { BudgetTracker, embedTexts } from './gemini.ts';

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
    // Group CSV rows cleanly so every chunk preserves exact Row range and full row records
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
      });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + safeSize);
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
        });
      }
      if (end >= text.length) break;
      start = Math.max(start + 1, end - safeOverlap);
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

function cosineSimilarity(a: number[], b: number[]): number {
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
  'the',
  'is',
  'at',
  'which',
  'on',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'with',
  'what',
  'how',
  'are',
  'do',
  'does',
  'can',
  'we',
  'our',
  'if',
  'about',
  'from',
  'by',
  'be',
  'this',
  'that',
  'it',
]);

function lexicalScore(query: string, docText: string): number {
  const qTokens = tokenize(query).filter((t) => !STOPWORDS.has(t));
  if (qTokens.length === 0) return 0;
  const dLower = docText.toLowerCase();
  const dSet = new Set(tokenize(docText));
  let hits = 0;
  for (const qt of qTokens) {
    if (dSet.has(qt)) {
      hits += 1;
    } else if (qt.length >= 4 && dLower.includes(qt)) {
      hits += 0.7;
    }
  }
  return Math.min(1, hits / Math.max(1, qTokens.length));
}

export async function retrieveRelevantChunks(params: {
  query: string;
  chunks: DocumentChunk[];
  config: RetrievalConfig;
  tracker?: BudgetTracker;
  useEmbeddings?: boolean;
}): Promise<RetrievedChunk[]> {
  if (params.chunks.length === 0) return [];

  let queryEmbedding: number[] | null = null;
  const hasChunkEmbeddings = params.chunks.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
  if (params.useEmbeddings !== false && hasChunkEmbeddings) {
    const vecs = await embedTexts([params.query], params.tracker);
    if (vecs && vecs[0]) {
      queryEmbedding = vecs[0];
    }
  }

  const scored = params.chunks.map((chunk) => {
    const lex = lexicalScore(params.query, `${chunk.document_name} ${chunk.source_text}`);
    let sem = 0;
    if (queryEmbedding && chunk.embedding && chunk.embedding.length === queryEmbedding.length) {
      sem = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
    }
    const hybridScore = queryEmbedding ? 0.65 * sem + 0.35 * lex : lex;
    return {
      chunk_id: chunk.chunk_id,
      document_name: chunk.document_name,
      page_or_row: chunk.page_or_row,
      source_text: chunk.source_text,
      similarity_score: Number(hybridScore.toFixed(4)),
    };
  });

  scored.sort((a, b) => b.similarity_score - a.similarity_score);

  const threshold = params.config.similarity_threshold ?? 0.25;
  const filtered = scored.filter((s) => s.similarity_score >= threshold);
  const topK = Math.max(1, Math.min(12, params.config.top_k || 4));
  if (filtered.length > 0) {
    return filtered.slice(0, topK);
  }
  // If threshold filtered everything out, return top 2 low-confidence candidates only if lexical > 0.1
  return scored.filter((s) => s.similarity_score >= 0.12).slice(0, Math.min(2, topK));
}
