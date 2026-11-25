import crypto from 'crypto';
import { Type } from '@google/genai';
import type {
  RetrievedChunk,
  ToolExecutionLog,
  TrustLedgerEntry,
  TrustStatus,
} from '../../src/types/forge.ts';
import { BudgetTracker, generateStructuredJson } from './gemini.ts';

const REFUSAL_PATTERNS = [
  /not (available|covered|present|found|included|specified) in (the )?(uploaded |provided )?(documents|files|policies|knowledge base|records)/i,
  /cannot (answer|provide|verify|confirm|assist with) (this|that|questions about)/i,
  /do not have (information|details|data|records|documentation) (on|about|regarding)/i,
  /outside (the )?scope of (the )?(uploaded |provided )?(documents|assistant)/i,
  /unable to (answer|verify|provide)/i,
  /no information (is )?(available|found|provided)/i,
];

export function detectRefusalInText(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

/**
 * Deterministic Ghost Citation Check ("Distrust-Your-Pipeline" Audit):
 * Extracts inline bracketed citations like [HR_Leave_Policy_2026.txt, Section 1]
 * and verifies that the cited filename actually appears in retrieved_evidence.
 */
export function detectGhostCitations(
  answer: string,
  retrieved_evidence: RetrievedChunk[]
): string[] {
  const retrievedDocs = new Set(
    retrieved_evidence.map((c) => c.document_name.toLowerCase())
  );
  const ghostCitations: string[] = [];
  const matches = answer.matchAll(/\[([A-Za-z0-9_.-]+\.(?:pdf|docx|txt|csv))[^\]]*\]/gi);
  for (const m of matches) {
    const citedDoc = m[1];
    if (!retrievedDocs.has(citedDoc.toLowerCase())) {
      ghostCitations.push(`Cited "${m[0]}" which was not present in retrieved evidence.`);
    }
  }
  return Array.from(new Set(ghostCitations));
}

/**
 * Deterministic Numeric Grounding Check:
 * Extracts currency values, percentages, and significant numbers from the answer
 * and verifies whether they appear in retrieved chunks or tool outputs.
 */
export function detectUngroundedNumbers(
  answer: string,
  retrieved_evidence: RetrievedChunk[],
  tool_executions: ToolExecutionLog[]
): string[] {
  if (detectRefusalInText(answer)) return [];

  const corpusText = [
    ...retrieved_evidence.map((c) => c.source_text),
    ...tool_executions.map((t) => `${JSON.stringify(t.arguments)} ${t.result_summary}`),
  ]
    .join(' ')
    .replace(/,/g, '');

  const normalizedAnswer = answer.replace(/,/g, '');
  // Ignore section numbers inside brackets like [Doc.txt, Section 1] or [Doc.txt, Row 4]
  const strippedCitations = normalizedAnswer.replace(/\[[^\]]+\]/g, '');
  const numericMatches = strippedCitations.match(/(?:\$?\d+(?:\.\d+)?%?)/g) ?? [];

  const ungrounded: string[] = [];
  for (const rawNum of numericMatches) {
    const bare = rawNum.replace(/[$%]/g, '');
    // Skip trivial 1-digit indices like "1", "2" unless attached to $ or %
    if (bare.length <= 1 && !rawNum.includes('$') && !rawNum.includes('%')) continue;
    if (!corpusText.includes(bare)) {
      ungrounded.push(rawNum);
    }
  }

  return Array.from(new Set(ungrounded)).slice(0, 5);
}

export async function verifyAnswerWithTrustLedger(params: {
  agent_id: string;
  question: string;
  answer: string;
  retrieved_evidence: RetrievedChunk[];
  tool_executions: ToolExecutionLog[];
  latency_ms: number;
  tracker?: BudgetTracker;
  skipLlmCheck?: boolean;
}): Promise<TrustLedgerEntry> {
  const isRefusal = detectRefusalInText(params.answer);
  const topRelevance =
    params.retrieved_evidence.length > 0
      ? Math.max(...params.retrieved_evidence.map((c) => c.similarity_score))
      : 0;

  const citedDocs = Array.from(new Set(params.retrieved_evidence.map((c) => c.document_name)));
  const citedLocs = Array.from(
    new Set(params.retrieved_evidence.map((c) => `${c.document_name} (${c.page_or_row})`))
  );

  // Run deterministic anti-lying checks
  const ghost_citations = detectGhostCitations(params.answer, params.retrieved_evidence);
  const ungrounded_numbers = detectUngroundedNumbers(
    params.answer,
    params.retrieved_evidence,
    params.tool_executions
  );

  let unsupported_claims: string[] = [
    ...ghost_citations,
    ...(ungrounded_numbers.length > 0
      ? [`Ungrounded numeric values not matched in retrieved chunks/tools: ${ungrounded_numbers.join(', ')}`]
      : []),
  ];
  let grounding_status: TrustStatus = 'GREEN';

  if (params.retrieved_evidence.length === 0 && params.tool_executions.length === 0) {
    if (isRefusal) {
      grounding_status = 'RED';
    } else {
      grounding_status = 'RED';
      unsupported_claims.push('Answer was produced with zero retrieved document evidence or tool outputs.');
    }
  } else if (isRefusal && topRelevance < 0.28) {
    grounding_status = 'RED';
  } else if (!params.skipLlmCheck) {
    try {
      const evidenceText = params.retrieved_evidence
        .map((c) => `[${c.document_name}, ${c.page_or_row}]: ${c.source_text}`)
        .join('\n\n');
      const toolText = params.tool_executions
        .map((t) => `[Tool ${t.tool}]: ${t.result_summary}`)
        .join('\n');

      const audit = await generateStructuredJson<{
        verdict: TrustStatus;
        unsupported_claims: string[];
      }>({
        tracker: params.tracker,
        lowThinking: true,
        prompt: `Audit this assistant answer strictly against the retrieved evidence and tool outputs.
Question: ${params.question}
Answer: ${params.answer}

Retrieved Evidence:
${evidenceText || 'None'}

Tool Outputs:
${toolText || 'None'}

Rules:
- GREEN: Every factual claim in the answer is directly supported by the retrieved evidence or tool outputs.
- YELLOW: Partially supported, missing a clear citation, or contains minor uncertainty/hedging.
- RED: Answer contains unsupported/fabricated claims OR question was unsupported and required refusal.
Return unsupported_claims as an array of specific unsupported statements (empty if GREEN).`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            verdict: { type: Type.STRING, enum: ['GREEN', 'YELLOW', 'RED'] },
            unsupported_claims: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['verdict', 'unsupported_claims'],
        },
      });
      grounding_status = audit.verdict;
      unsupported_claims = Array.from(
        new Set([...unsupported_claims, ...(audit.unsupported_claims ?? [])])
      );
    } catch {
      grounding_status = isRefusal ? 'RED' : topRelevance >= 0.35 ? 'GREEN' : 'YELLOW';
    }
  } else {
    grounding_status = isRefusal ? 'RED' : topRelevance >= 0.32 ? 'GREEN' : 'YELLOW';
  }

  // Deterministic override: never report GREEN if ghost citations or ungrounded numbers were caught
  if (grounding_status === 'GREEN' && (ghost_citations.length > 0 || ungrounded_numbers.length > 0)) {
    grounding_status = 'YELLOW';
  }

  return {
    id: `tl_${crypto.randomUUID().slice(0, 8)}`,
    agent_id: params.agent_id,
    timestamp: new Date().toISOString(),
    question: params.question,
    answer: params.answer,
    supporting_documents: citedDocs,
    supporting_locations: citedLocs,
    retrieved_evidence: params.retrieved_evidence,
    evidence_relevance: Number(topRelevance.toFixed(3)),
    grounding_status,
    unsupported_claims,
    deterministic_checks: {
      ghost_citations,
      ungrounded_numbers,
    },
    tool_executions: params.tool_executions,
    latency_ms: params.latency_ms,
  };
}
