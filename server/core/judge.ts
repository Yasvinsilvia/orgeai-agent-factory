import { Type } from '@google/genai';
import type {
  AgentDefinition,
  DocumentChunk,
  EvalCaseResult,
  EvalTestCase,
  FailureCategory,
  RetrievedChunk,
} from '../../src/types/forge.ts';
import { runAgentTurn } from './agentRunner.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';
import { ensureChunkEmbeddings } from './retrieval.ts';
import type { CsvTableSource } from './tools.ts';
import {
  detectAnswerContradictions,
  detectGhostCitations,
  detectRefusalInText,
  detectUngroundedNumbers,
} from './trustLedger.ts';

const MONTH_ALIASES: Record<string, string> = {
  january: 'jan', jan: 'jan',
  february: 'feb', feb: 'feb',
  march: 'mar', mar: 'mar',
  april: 'apr', apr: 'apr',
  may: 'may',
  june: 'jun', jun: 'jun',
  july: 'jul', jul: 'jul',
  august: 'aug', aug: 'aug',
  september: 'sep', sept: 'sep', sep: 'sep',
  october: 'oct', oct: 'oct',
  november: 'nov', nov: 'nov',
  december: 'dec', dec: 'dec',
};

function normalizeDatesAndNumbers(text: string): string {
  let norm = text.toLowerCase().replace(/,/g, '');
  for (const [full, abbr] of Object.entries(MONTH_ALIASES)) {
    norm = norm.replace(new RegExp(`\\b${full}\\b`, 'g'), abbr);
  }
  return norm;
}

function extractCriticalFactEntities(fact: string): string[] {
  const norm = normalizeDatesAndNumbers(fact);
  const entities: string[] = [];

  // Month + Day patterns (e.g., "mar 31", "dec 31")
  const dateMatches = norm.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\b/g) ?? [];
  entities.push(...dateMatches);

  // Part IDs / codes (e.g., "sp-1002", "sup-01")
  const codeMatches = norm.match(/\b[a-z]{2,}-\d+\b/g) ?? [];
  entities.push(...codeMatches);

  // Numbers, currency, percentages, times (e.g. "$35", "1.5x", "09:45", "15")
  const numMatches = norm.match(/\$?\d+(?::\d{2})?(?:\.\d+)?%?/g) ?? [];
  for (const n of numMatches) {
    entities.push(n.replace(/^\$/, ''));
  }

  return Array.from(new Set(entities));
}

export function computeDeterministicFactMatch(
  answer: string,
  expectedFacts: string[]
): {
  ratio: number;
  matched: number;
  total: number;
  entity_ratio: number;
  missed_entities: string[];
} {
  if (expectedFacts.length === 0) {
    return { ratio: 1, matched: 0, total: 0, entity_ratio: 1, missed_entities: [] };
  }
  const ansNorm = normalizeDatesAndNumbers(answer);
  let matched = 0;
  let totalEntities = 0;
  let matchedEntities = 0;
  const missed_entities: string[] = [];

  for (const fact of expectedFacts) {
    const factNorm = normalizeDatesAndNumbers(fact);
    const entities = extractCriticalFactEntities(fact);
    let factEntitiesOk = true;
    for (const ent of entities) {
      totalEntities += 1;
      // Match whole numeric/entity boundaries where applicable so "5" does not match "15"
      const escaped = ent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const entRe = /^\d+(?:\.\d+)?%?$/.test(ent)
        ? new RegExp(`(?:^|[^0-9.])${escaped}(?=$|[^0-9.])`)
        : new RegExp(escaped);
      if (entRe.test(ansNorm)) {
        matchedEntities += 1;
      } else {
        factEntitiesOk = false;
        missed_entities.push(ent);
      }
    }

    const tokens = factNorm
      .replace(/\$/g, '')
      .replace(/[^a-z0-9.%:-]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) continue;
    const ansCleanForTokens = ansNorm.replace(/\$/g, '');
    const hits = tokens.filter((t) => ansCleanForTokens.includes(t)).length;
    const tokenOverlapOk = hits / tokens.length >= 0.55;

    if (tokenOverlapOk && factEntitiesOk) {
      matched += 1;
    }
  }

  return {
    ratio: Number((matched / expectedFacts.length).toFixed(2)),
    matched,
    total: expectedFacts.length,
    entity_ratio: totalEntities > 0 ? Number((matchedEntities / totalEntities).toFixed(2)) : 1,
    missed_entities: Array.from(new Set(missed_entities)),
  };
}

export function computeDeterministicCitationMatch(
  answer: string,
  expectedDocs: string[]
): { score: number; hasBracketCitation: boolean } {
  const hasBracketCitation = /\[[^\]]+\]/.test(answer);
  if (expectedDocs.length === 0) {
    return { score: 1, hasBracketCitation };
  }
  const ansLower = answer.toLowerCase();
  let hits = 0;
  for (const doc of expectedDocs) {
    const stem = doc.replace(/\.[^.]+$/, '').toLowerCase();
    if (ansLower.includes(doc.toLowerCase()) || ansLower.includes(stem)) {
      hits += 1;
    }
  }
  const docCoverage = hits / expectedDocs.length;
  const score = hasBracketCitation ? Math.min(1, 0.35 + 0.65 * docCoverage) : docCoverage * 0.6;
  return { score: Number(score.toFixed(2)), hasBracketCitation };
}

export interface LlmJudgeScoresInput {
  grounding?: number;
  correctness?: number;
  refusal_accuracy?: number;
  citation_accuracy?: number;
  relevance?: number;
  passed?: boolean;
  failure_category?: FailureCategory;
  failure_explanation?: string;
}

/**
 * Pure hybrid adjudication combining deterministic fact/entity/citation/contradiction checks
 * with LLM judge rubric scores to prevent false-positive passes on misleading or partial answers.
 */
export function adjudicateEvalCase(params: {
  tc: EvalTestCase;
  answer: string;
  retrieved_evidence: RetrievedChunk[];
  tool_calls_used: string[];
  llmEval?: LlmJudgeScoresInput;
}): EvalCaseResult {
  const detFacts = computeDeterministicFactMatch(params.answer, params.tc.expected_facts);
  const detCite = computeDeterministicCitationMatch(
    params.answer,
    params.tc.expected_source_documents
  );
  const detRefusal = detectRefusalInText(params.answer);
  const ghostCitations = detectGhostCitations(params.answer, params.retrieved_evidence);
  const toolLogs = params.tool_calls_used.map((t) => ({
    tool: t as AgentDefinition['selected_tools'][number],
    arguments: {},
    result_summary: params.answer,
  }));
  const ungroundedNumbers = params.tc.expected_refusal
    ? []
    : detectUngroundedNumbers(params.answer, params.retrieved_evidence, toolLogs);
  const contradictions = detectAnswerContradictions(
    params.answer,
    params.retrieved_evidence,
    params.tc.expected_facts
  );

  const penalties: string[] = [];

  let grounding = clamp01(
    params.llmEval?.grounding ?? (detRefusal && params.tc.expected_refusal ? 1 : 0.75)
  );
  if (ghostCitations.length > 0) {
    grounding = clamp01(grounding - 0.25);
    penalties.push(`Ghost citation(s): ${ghostCitations.length}`);
  }
  if (ungroundedNumbers.length > 0) {
    const deduction = Math.min(0.55, ungroundedNumbers.length * 0.22);
    grounding = clamp01(grounding - deduction);
    penalties.push(`Ungrounded numbers: ${ungroundedNumbers.join(', ')}`);
  }
  if (contradictions.length > 0) {
    grounding = Math.min(grounding, 0.25);
    penalties.push(`Contradictions: ${contradictions.join(' | ')}`);
  }
  if (!params.tc.expected_refusal && params.retrieved_evidence.length === 0 && params.tool_calls_used.length === 0) {
    grounding = Math.min(grounding, 0.2);
    penalties.push('Zero retrieved evidence or tool support');
  }

  // Correctness combines deterministic fact+entity verification with LLM semantic score
  const rawCorrectness = clamp01(params.llmEval?.correctness ?? detFacts.ratio);
  let correctness: number;
  if (params.tc.expected_refusal) {
    correctness = detRefusal && contradictions.length === 0 ? 1 : 0;
  } else {
    const detCombined = 0.65 * detFacts.ratio + 0.35 * detFacts.entity_ratio;
    correctness = Number((0.48 * detCombined + 0.52 * rawCorrectness).toFixed(2));
    if (detFacts.missed_entities.length > 0) {
      correctness = Math.min(correctness, clamp01(0.45 + 0.35 * detFacts.entity_ratio));
      penalties.push(`Missed critical entities: ${detFacts.missed_entities.join(', ')}`);
    }
    if (contradictions.length > 0) {
      correctness = Math.min(correctness, 0.2);
    }
  }

  const refusal_accuracy =
    params.tc.expected_refusal === detRefusal
      ? 1
      : clamp01(params.llmEval?.refusal_accuracy ?? 0);

  let citation_accuracy = params.tc.expected_refusal
    ? 1
    : Number(
        (0.5 * detCite.score + 0.5 * clamp01(params.llmEval?.citation_accuracy ?? detCite.score)).toFixed(2)
      );
  if (ghostCitations.length > 0) {
    citation_accuracy = Math.min(citation_accuracy, 0.45);
  }

  const relevance = clamp01(params.llmEval?.relevance ?? 0.8);

  const overall = Number(
    (
      0.28 * grounding +
      0.32 * correctness +
      0.2 * refusal_accuracy +
      0.12 * citation_accuracy +
      0.08 * relevance
    ).toFixed(2)
  );

  // Independent threshold gates to block false-positive passes
  let passed =
    (params.llmEval?.passed ?? true) &&
    overall >= 0.72 &&
    grounding >= 0.65 &&
    refusal_accuracy >= 0.7 &&
    contradictions.length === 0 &&
    ghostCitations.length === 0;

  if (!params.tc.expected_refusal && correctness < 0.6) {
    passed = false;
  }

  let failure_category: FailureCategory = params.llmEval?.failure_category ?? 'none';
  let failure_explanation = params.llmEval?.failure_explanation ?? '';

  if (contradictions.length > 0) {
    passed = false;
    failure_category = 'hallucination';
    failure_explanation = contradictions.join(' ');
  } else if (params.tc.expected_refusal && !detRefusal && refusal_accuracy < 0.7) {
    passed = false;
    failure_category = 'wrong_refusal';
    failure_explanation =
      failure_explanation || 'Agent failed to refuse an out-of-scope or unsupported question.';
  } else if (!params.tc.expected_refusal && detRefusal) {
    passed = false;
    failure_category = 'wrong_refusal';
    failure_explanation =
      failure_explanation || 'Agent wrongly refused an answerable question supported by documents.';
  } else if (ghostCitations.length > 0) {
    passed = false;
    failure_category = 'incorrect_citation';
    failure_explanation = ghostCitations.join(' ');
  }

  if (passed) {
    failure_category = 'none';
    failure_explanation = 'Passed all grounding, factual, entity, refusal, and citation checks.';
  } else if (failure_category === 'none') {
    failure_category =
      grounding < 0.65 || ungroundedNumbers.length > 0
        ? 'hallucination'
        : citation_accuracy < 0.6
        ? 'incorrect_citation'
        : !params.tc.expected_refusal && params.retrieved_evidence.length === 0
        ? 'retrieval_miss'
        : 'incomplete_answer';
    if (!failure_explanation && penalties.length > 0) {
      failure_explanation = penalties.join('; ');
    }
  }

  return {
    test_id: params.tc.test_id,
    question: params.tc.question,
    category: params.tc.category,
    expected_refusal: params.tc.expected_refusal,
    expected_facts: params.tc.expected_facts,
    expected_source_documents: params.tc.expected_source_documents,
    agent_response: params.answer,
    retrieved_evidence: params.retrieved_evidence,
    scores: {
      grounding,
      correctness,
      refusal_accuracy,
      citation_accuracy,
      relevance,
      overall,
    },
    passed,
    failure_category,
    failure_explanation,
    tool_calls_used: params.tool_calls_used,
    ...(contradictions.length > 0 ? { contradictions_detected: contradictions } : {}),
    ...(penalties.length > 0 ? { deterministic_penalties: penalties } : {}),
  };
}

export async function evaluateAgentOnSuite(params: {
  agent: AgentDefinition;
  testCases: EvalTestCase[];
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  tracker?: BudgetTracker;
}): Promise<EvalCaseResult[]> {
  const judgeSystem = loadPromptTemplate('judge_prompt.txt');
  const results: EvalCaseResult[] = [];

  // Ensure corpus embeddings exist BEFORE running parallel eval turns so all evals use real hybrid embedding retrieval
  const ensured = await ensureChunkEmbeddings(params.chunks, params.tracker);
  const embeddedChunks = ensured.chunks;

  // Execute agent turns with small concurrency of 2 to avoid transient 503 overload spikes
  const turnOutputs: Array<{
    tc: EvalTestCase;
    answer: string;
    retrieved_evidence: EvalCaseResult['retrieved_evidence'];
    tool_calls_used: string[];
  }> = [];

  for (let i = 0; i < params.testCases.length; i += 2) {
    const batch = params.testCases.slice(i, i + 2);
    const settled = await Promise.all(
      batch.map(async (tc) => {
        const turn = await runAgentTurn({
          agent: params.agent,
          question: tc.question,
          chunks: embeddedChunks,
          csvSources: params.csvSources,
          tracker: params.tracker,
          useEmbeddings: true,
          skipTrustLlmCheck: true,
        });
        return {
          tc,
          answer: turn.answer,
          retrieved_evidence: turn.retrieved_evidence,
          tool_calls_used: turn.tool_executions.map((t) => t.tool),
        };
      })
    );
    turnOutputs.push(...settled);
  }

  // Hybrid judge: deterministic checks + batched LLM rubric grading
  for (let i = 0; i < turnOutputs.length; i += 5) {
    const batch = turnOutputs.slice(i, i + 5);

    const batchItems = batch.map((item) => {
      const detFacts = computeDeterministicFactMatch(item.answer, item.tc.expected_facts);
      const detCite = computeDeterministicCitationMatch(
        item.answer,
        item.tc.expected_source_documents
      );
      const detRefusal = detectRefusalInText(item.answer);
      const detContradictions = detectAnswerContradictions(
        item.answer,
        item.retrieved_evidence,
        item.tc.expected_facts
      );
      return {
        item,
        detFacts,
        detCite,
        detRefusal,
        detContradictions,
      };
    });

    const judgePrompt = `
Evaluate these ${batchItems.length} test case responses strictly using the rubric. Do NOT reward verbosity. Penalize ungrounded claims, numeric errors, and contradictions.

${batchItems
  .map(
    (b, idx) => `=== CASE ${idx + 1}: ${b.item.tc.test_id} (${b.item.tc.category}) ===
Question: ${b.item.tc.question}
Expected Refusal: ${b.item.tc.expected_refusal}
Expected Facts: ${JSON.stringify(b.item.tc.expected_facts)}
Expected Source Docs: ${JSON.stringify(b.item.tc.expected_source_documents)}
Deterministic Signals -> FactOverlap: ${b.detFacts.matched}/${b.detFacts.total}, EntityMatch: ${b.detFacts.entity_ratio}, CitationMatch: ${b.detCite.score}, RefusalDetected: ${b.detRefusal}, Contradictions: ${JSON.stringify(b.detContradictions)}
Retrieved Evidence Chunks:
${
  b.item.retrieved_evidence.length > 0
    ? b.item.retrieved_evidence
        .map((c) => `[${c.document_name}, ${c.page_or_row}]: ${c.source_text.slice(0, 260)}`)
        .join('\n')
    : 'NONE'
}
Agent Response:
${b.item.answer}
`
  )
  .join('\n\n')}
`;

    const judged = await generateStructuredJson<{
      evaluations: Array<{
        test_id: string;
        grounding: number;
        correctness: number;
        refusal_accuracy: number;
        citation_accuracy: number;
        relevance: number;
        passed: boolean;
        failure_category: FailureCategory;
        failure_explanation: string;
      }>;
    }>({
      systemInstruction: judgeSystem,
      prompt: judgePrompt,
      tracker: params.tracker,
      lowThinking: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          evaluations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                test_id: { type: Type.STRING },
                grounding: { type: Type.NUMBER },
                correctness: { type: Type.NUMBER },
                refusal_accuracy: { type: Type.NUMBER },
                citation_accuracy: { type: Type.NUMBER },
                relevance: { type: Type.NUMBER },
                passed: { type: Type.BOOLEAN },
                failure_category: {
                  type: Type.STRING,
                  enum: [
                    'none',
                    'retrieval_miss',
                    'prompt_defect',
                    'hallucination',
                    'wrong_refusal',
                    'incorrect_citation',
                    'incomplete_answer',
                  ],
                },
                failure_explanation: { type: Type.STRING },
              },
              required: [
                'test_id',
                'grounding',
                'correctness',
                'refusal_accuracy',
                'citation_accuracy',
                'relevance',
                'passed',
                'failure_category',
                'failure_explanation',
              ],
            },
          },
        },
        required: ['evaluations'],
      },
    });

    const evalMap = new Map((judged.evaluations ?? []).map((e) => [e.test_id, e]));

    for (const b of batchItems) {
      results.push(
        adjudicateEvalCase({
          tc: b.item.tc,
          answer: b.item.answer,
          retrieved_evidence: b.item.retrieved_evidence,
          tool_calls_used: b.item.tool_calls_used,
          llmEval: evalMap.get(b.item.tc.test_id),
        })
      );
    }
  }

  return results;
}

function clamp01(val: number): number {
  if (Number.isNaN(val)) return 0;
  return Math.max(0, Math.min(1, Number(val.toFixed(2))));
}
