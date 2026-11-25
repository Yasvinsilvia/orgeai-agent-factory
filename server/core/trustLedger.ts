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

export function detectAnswerContradictions(
  answer: string,
  retrieved_evidence: RetrievedChunk[],
  expected_facts?: string[]
): string[] {
  const contradictions: string[] = [];
  const ansLower = answer.toLowerCase();
  const isRefusal = detectRefusalInText(answer);
  if (isRefusal) return [];

  // 1. Polarity contradiction against expected facts or retrieved clauses (e.g. "not encashable" vs "is encashable")
  const referenceStrings = [
    ...(expected_facts ?? []),
    ...retrieved_evidence.map((c) => c.source_text),
  ];

  const negationRules: Array<{
    mustBeNegative: RegExp;
    positiveAssert: RegExp;
    label: string;
  }> = [
    {
      mustBeNegative: /\bnot\s+encashable\b/i,
      positiveAssert: /\b(?:is|are|can\s+be)\s+encashable\b|\bcan\s+(?:be\s+)?cash(?:ed)?\s+out\b/i,
      label: 'Contradicts policy stating unused leave/items are NOT encashable.',
    },
    {
      mustBeNegative: /\b(?:alcohol|usb|personal\s+usb)\b[^.]{0,40}\b(?:excluded|prohibited|forbidden|not\s+permitted|banned)\b/i,
      positiveAssert: /\b(?:alcohol|usb)\b[^.]{0,30}\b(?:reimbursable|permitted|allowed|covered)\b/i,
      label: 'Contradicts explicit exclusion/prohibition rule in policy.',
    },
    {
      mustBeNegative: /\bdoes\s+not\s+carry\s+over\b|\bno\s+carry-?over\b/i,
      positiveAssert: /\bcan\s+carry\s+over\b|\bcarries\s+over\b/i,
      label: 'Contradicts non-carryover rule.',
    },
    {
      mustBeNegative: /\bno\s+bulk\s+discount\b/i,
      positiveAssert: /\b(?:offers?|includes?|receives?)\s+(?:a\s+)?(?:\d+%\s+)?bulk\s+discount\b/i,
      label: 'Contradicts "no bulk discount" supplier clause.',
    },
  ];

  const corpusJoined = referenceStrings.join(' \n ');
  for (const rule of negationRules) {
    if (rule.mustBeNegative.test(corpusJoined) && rule.positiveAssert.test(ansLower)) {
      contradictions.push(rule.label);
    }
  }

  // 2. Fact-level negation reversal check on expected_facts
  if (expected_facts && expected_facts.length > 0) {
    for (const fact of expected_facts) {
      const fLower = fact.toLowerCase();
      const factHasNeg = /\b(not|never|no|prohibited|excluded|cannot|without)\b/.test(fLower);
      const coreTerms = fLower
        .replace(/\b(not|never|no|is|are|be|the|a|an|of|to|in|for|with|and|or)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 4);
      if (factHasNeg && coreTerms.length > 0) {
        const matchedTerms = coreTerms.filter((t) => ansLower.includes(t));
        const ansHasNeg = /\b(not|never|no|prohibited|excluded|cannot|ineligible|non-|disallowed|unallowable)\b/.test(
          ansLower
        );
        if (matchedTerms.length === coreTerms.length && !ansHasNeg) {
          contradictions.push(
            `Polarity mismatch on expected fact "${fact}": answer omits required negation.`
          );
        }
      }
    }
  }

  return Array.from(new Set(contradictions));
}

export function computeCalibratedConfidence(params: {
  grounding_status: TrustStatus;
  top_relevance: number;
  evidence_count: number;
  tool_count: number;
  is_refusal: boolean;
  ghost_citations: string[];
  ungrounded_numbers: string[];
  contradictions: string[];
  unsupported_claims: string[];
}): { confidence_score: number; calibration_reason: string } {
  let score = 50;
  const reasons: string[] = [];

  if (params.is_refusal) {
    if (params.evidence_count === 0 || params.top_relevance < 0.25) {
      score = 90;
      reasons.push('High-confidence refusal: no relevant document chunks support this topic');
    } else {
      score = 45;
      reasons.push('Uncertain refusal: relevant chunks existed in corpus');
    }
  } else {
    const relComponent = Math.round(Math.min(1, params.top_relevance / 0.85) * 65);
    const supportBonus = Math.min(20, params.evidence_count * 5 + params.tool_count * 7);
    score = Math.min(98, 12 + relComponent + supportBonus);
    reasons.push(
      `Relevance ${Math.round(params.top_relevance * 100)}% across ${params.evidence_count} chunk(s)`
    );
  }

  if (params.ghost_citations.length > 0) {
    score -= 25 * params.ghost_citations.length;
    reasons.push(`-${25 * params.ghost_citations.length} for ghost citation(s)`);
  }
  if (params.ungrounded_numbers.length > 0) {
    const penalty = Math.min(35, params.ungrounded_numbers.length * 14);
    score -= penalty;
    reasons.push(`-${penalty} for unverified numeric value(s)`);
  }
  if (params.contradictions.length > 0) {
    score -= 40;
    reasons.push('-40 for policy contradiction');
  }
  if (params.grounding_status === 'YELLOW') {
    score = Math.min(score, 74);
    reasons.push('Capped at 74% (YELLOW partial support)');
  } else if (params.grounding_status === 'RED' && !params.is_refusal) {
    score = Math.min(score, 35);
    reasons.push('Capped at 35% (RED unsupported answer)');
  } else if (params.unsupported_claims.length > 0 && !params.is_refusal) {
    score = Math.min(score, 68);
  }

  return {
    confidence_score: Math.max(5, Math.min(99, Math.round(score))),
    calibration_reason: reasons.join('; '),
  };
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
  const contradictions = detectAnswerContradictions(params.answer, params.retrieved_evidence);

  let unsupported_claims: string[] = [
    ...ghost_citations,
    ...(ungrounded_numbers.length > 0
      ? [`Ungrounded numeric values not matched in retrieved chunks/tools: ${ungrounded_numbers.join(', ')}`]
      : []),
    ...contradictions,
  ];
  let grounding_status: TrustStatus = 'GREEN';

  if (params.retrieved_evidence.length === 0 && params.tool_executions.length === 0) {
    grounding_status = 'RED';
    if (!isRefusal) {
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

  // Deterministic override: never report GREEN if ghost citations, ungrounded numbers, or contradictions were caught
  if (contradictions.length > 0) {
    grounding_status = 'RED';
  } else if (
    grounding_status === 'GREEN' &&
    (ghost_citations.length > 0 || ungrounded_numbers.length > 0)
  ) {
    grounding_status = 'YELLOW';
  }

  const calibrated = computeCalibratedConfidence({
    grounding_status,
    top_relevance: topRelevance,
    evidence_count: params.retrieved_evidence.length,
    tool_count: params.tool_executions.length,
    is_refusal: isRefusal,
    ghost_citations,
    ungrounded_numbers,
    contradictions,
    unsupported_claims,
  });

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
    confidence_score: calibrated.confidence_score,
    calibration_reason: calibrated.calibration_reason,
    unsupported_claims,
    deterministic_checks: {
      ghost_citations,
      ungrounded_numbers,
      contradictions,
    },
    tool_executions: params.tool_executions,
    latency_ms: params.latency_ms,
  };
}
