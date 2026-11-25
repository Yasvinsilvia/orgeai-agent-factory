import crypto from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import mammoth from 'mammoth';
import path from 'path';
import type { DocumentFile } from '../../src/types/forge.ts';

export interface ExtractedSegment {
  page_or_row: string;
  text: string;
  injection_sanitized?: boolean;
}

export interface ProcessedFileResult {
  file: DocumentFile;
  segments: ExtractedSegment[];
}

const INJECTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'instruction_override',
    regex: /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:previous|prior|above|system|earlier|safety|refusal)\s+(?:instructions?|rules?|prompts?|guidelines?|constraints?)/gi,
  },
  {
    label: 'system_prompt_exfiltration',
    regex: /\b(?:reveal|print|output|repeat|leak|disclose)\s+(?:your\s+)?(?:hidden\s+|full\s+|exact\s+)?(?:system\s+prompt|developer\s+instructions?|secret\s+key|api\s+key)/gi,
  },
  {
    label: 'role_hijack_marker',
    regex: /(?:<\|im_start\|>|<\|system\|>|\[SYSTEM\s+OVERRIDE\]|###\s*(?:SYSTEM|INSTRUCTION)\s*:|\byou\s+are\s+now\s+(?:in\s+developer\s+mode|DAN|an?\s+unrestricted))/gi,
  },
  {
    label: 'forced_tool_or_output',
    regex: /\b(?:must\s+always\s+respond\s+with|never\s+refuse\s+any\s+question|always\s+answer\s+even\s+if\s+unsupported)\b/gi,
  },
];

export function scanAndSanitizePromptInjection(text: string): {
  sanitizedText: string;
  flags: string[];
} {
  let sanitizedText = text;
  const flags = new Set<string>();

  for (const pat of INJECTION_PATTERNS) {
    pat.regex.lastIndex = 0;
    if (pat.regex.test(sanitizedText)) {
      flags.add(pat.label);
      pat.regex.lastIndex = 0;
      sanitizedText = sanitizedText.replace(
        pat.regex,
        `[SANITIZED_INJECTION_DIRECTIVE:${pat.label}]`
      );
    }
  }

  return {
    sanitizedText,
    flags: Array.from(flags),
  };
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfSegments(buffer: Buffer): Promise<ExtractedSegment[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const segments: ExtractedSegment[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item: unknown) => {
        if (typeof item === 'object' && item !== null && 'str' in item) {
          return String((item as { str: unknown }).str);
        }
        return '';
      })
      .filter(Boolean);
    const pageText = cleanText(strings.join(' '));
    if (pageText.length > 0) {
      segments.push({
        page_or_row: `Page ${pageNum}`,
        text: pageText,
      });
    }
  }
  return segments;
}

async function extractDocxSegments(buffer: Buffer): Promise<ExtractedSegment[]> {
  const result = await mammoth.extractRawText({ buffer });
  const text = cleanText(result.value ?? '');
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const segments: ExtractedSegment[] = [];
  const groupSize = 4;
  for (let i = 0; i < paragraphs.length; i += groupSize) {
    const slice = paragraphs.slice(i, i + groupSize).join('\n\n');
    const sectionNum = Math.floor(i / groupSize) + 1;
    segments.push({
      page_or_row: `Section ${sectionNum}`,
      text: slice,
    });
  }
  return segments;
}

function extractTxtSegments(buffer: Buffer): ExtractedSegment[] {
  const text = cleanText(buffer.toString('utf-8'));
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const segments: ExtractedSegment[] = [];
  let bufferText = '';
  let sectionIdx = 1;
  for (const para of paragraphs) {
    if (bufferText.length + para.length > 1400 && bufferText.length > 0) {
      segments.push({
        page_or_row: `Section ${sectionIdx}`,
        text: bufferText.trim(),
      });
      sectionIdx += 1;
      bufferText = para;
    } else {
      bufferText = bufferText ? `${bufferText}\n\n${para}` : para;
    }
  }
  if (bufferText.trim().length > 0) {
    segments.push({
      page_or_row: `Section ${sectionIdx}`,
      text: bufferText.trim(),
    });
  }
  return segments;
}

function extractCsvSegments(buffer: Buffer): ExtractedSegment[] {
  const raw = buffer.toString('utf-8').trim();
  if (!raw) return [];
  const records = parseCsv(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return records.map((row, idx) => {
    const rowNum = idx + 1;
    const fields = Object.entries(row)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    return {
      page_or_row: `Row ${rowNum}`,
      text: fields,
    };
  });
}

export async function processUploadedFile(params: {
  agent_id: string;
  filename: string;
  buffer: Buffer;
  existingHashes: Set<string>;
  is_demo?: boolean;
}): Promise<ProcessedFileResult> {
  const ext = path.extname(params.filename).toLowerCase().replace('.', '');
  const id = `doc_${crypto.randomUUID().slice(0, 8)}`;
  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const uploaded_at = new Date().toISOString();

  if (!['pdf', 'docx', 'txt', 'csv'].includes(ext)) {
    return {
      file: {
        id,
        agent_id: params.agent_id,
        filename: params.filename,
        file_type: 'txt',
        size_bytes: params.buffer.length,
        sha256,
        page_or_row_count: 0,
        chunk_count: 0,
        is_demo: params.is_demo,
        uploaded_at,
        status: 'error',
        error_message: `Unsupported file format ".${ext}". Supported formats: PDF, DOCX, TXT, CSV.`,
        preview_text: '',
      },
      segments: [],
    };
  }

  const file_type = ext as 'pdf' | 'docx' | 'txt' | 'csv';

  if (params.buffer.length === 0) {
    return {
      file: {
        id,
        agent_id: params.agent_id,
        filename: params.filename,
        file_type,
        size_bytes: 0,
        sha256,
        page_or_row_count: 0,
        chunk_count: 0,
        is_demo: params.is_demo,
        uploaded_at,
        status: 'error',
        error_message: 'File is empty (0 bytes).',
        preview_text: '',
      },
      segments: [],
    };
  }

  if (params.existingHashes.has(sha256)) {
    return {
      file: {
        id,
        agent_id: params.agent_id,
        filename: params.filename,
        file_type,
        size_bytes: params.buffer.length,
        sha256,
        page_or_row_count: 0,
        chunk_count: 0,
        is_demo: params.is_demo,
        uploaded_at,
        status: 'duplicate_skipped',
        error_message: 'Duplicate file content detected (matching SHA-256 hash); skipped re-indexing.',
        preview_text: '',
      },
      segments: [],
    };
  }

  try {
    let segments: ExtractedSegment[] = [];
    if (file_type === 'pdf') {
      segments = await extractPdfSegments(params.buffer);
    } else if (file_type === 'docx') {
      segments = await extractDocxSegments(params.buffer);
    } else if (file_type === 'csv') {
      segments = extractCsvSegments(params.buffer);
    } else {
      segments = extractTxtSegments(params.buffer);
    }

    if (segments.length === 0) {
      return {
        file: {
          id,
          agent_id: params.agent_id,
          filename: params.filename,
          file_type,
          size_bytes: params.buffer.length,
          sha256,
          page_or_row_count: 0,
          chunk_count: 0,
          is_demo: params.is_demo,
          uploaded_at,
          status: 'error',
          error_message: 'No extractable text found in file (may be blank or image-only scan).',
          preview_text: '',
        },
        segments: [],
      };
    }

    const allFlags = new Set<string>();
    const sanitizedSegments: ExtractedSegment[] = segments.map((seg) => {
      const scanned = scanAndSanitizePromptInjection(seg.text);
      for (const flag of scanned.flags) {
        allFlags.add(`${seg.page_or_row}: ${flag}`);
      }
      return {
        page_or_row: seg.page_or_row,
        text: scanned.sanitizedText,
        ...(scanned.flags.length > 0 ? { injection_sanitized: true } : {}),
      };
    });

    params.existingHashes.add(sha256);
    const preview_text = sanitizedSegments
      .slice(0, 2)
      .map((s) => `[${s.page_or_row}] ${s.text}`)
      .join('\n')
      .slice(0, 420);

    return {
      file: {
        id,
        agent_id: params.agent_id,
        filename: params.filename,
        file_type,
        size_bytes: params.buffer.length,
        sha256,
        page_or_row_count: sanitizedSegments.length,
        chunk_count: 0,
        is_demo: params.is_demo,
        uploaded_at,
        status: 'processed',
        preview_text,
        ...(allFlags.size > 0 ? { prompt_injection_flags: Array.from(allFlags) } : {}),
      },
      segments: sanitizedSegments,
    };
  } catch (err: unknown) {
    return {
      file: {
        id,
        agent_id: params.agent_id,
        filename: params.filename,
        file_type,
        size_bytes: params.buffer.length,
        sha256,
        page_or_row_count: 0,
        chunk_count: 0,
        is_demo: params.is_demo,
        uploaded_at,
        status: 'error',
        error_message: `Failed to parse ${file_type.toUpperCase()} file: ${
          err instanceof Error ? err.message : String(err)
        }`,
        preview_text: '',
      },
      segments: [],
    };
  }
}
