import { Type } from '@google/genai';
import type {
  AgentDefinition,
  DocumentChunk,
  EvalCaseResult,
  EvalTestCase,
  FailureCategory,
} from '../../src/types/forge.ts';
import { runAgentTurn } from './agentRunner.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';
import type { CsvTableSource } from './tools.ts';
import { detectRefusalInText } from './trustLedger.ts';

function computeDeterministicFactMatch(
  answer: string,
  expectedFacts: string[]
): { ratio: number; matched: number; total: number } {
  if (expectedFacts.length === 0) return { ratio: 1, matched: 0, total: 0 };
  const ansLower = answer.toLowerCase();
  let matched = 0;
  for (const fact of expectedFacts) {
    const tokens = fact
      .toLowerCase()
      .replace(/[^a-z0-9.%$-]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => ansLower.includes(t)).length;
    if (hits / tokens.length >= 0.55) {
      matched += 1;
    }
  }
  return {
    ratio: matched / expectedFacts.length,
    matched,
    total: expectedFacts.length,
  };
}

function computeDeterministicCitationMatch(
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

export async function evaluateAgentOnSuite(params: {
  agent: AgentDefinition;
  testCases: EvalTestCase[];
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  tracker?: BudgetTracker;
}): Promise<EvalCaseResult[]> {
  const judgeSystem = loadPromptTemplate('judge_prompt.txt');
  const results: EvalCaseResult[] = [];

  // Execute agent turns with small concurrency of 3
  const turnOutputs: Array<{
    tc: EvalTestCase;
    answer: string;
    retrieved_evidence: EvalCaseResult['retrieved_evidence'];
    tool_calls_used: string[];
  }> = [];

  for (let i = 0; i < params.testCases.length; i += 3) {
    const batch = params.testCases.slice(i, i + 3);
    const settled = await Promise.all(
      batch.map(async (tc) => {
        const turn = await runAgentTurn({
          agent: params.agent,
          question: tc.question,
          chunks: params.chunks,
          csvSources: params.csvSources,
          tracker: params.tracker,
          useEmbeddings: false,
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

  // Hybrid judge: deterministic checks + batched LLM rubric grading (defending against verbosity/position/self-preference bias)
  for (let i = 0; i < turnOutputs.length; i += 5) {
    const batch = turnOutputs.slice(i, i + 5);

    const batchItems = batch.map((item) => {
      const detFacts = computeDeterministicFactMatch(item.answer, item.tc.expected_facts);
      const detCite = computeDeterministicCitationMatch(
        item.answer,
        item.tc.expected_source_documents
      );
      const detRefusal = detectRefusalInText(item.answer);
      return {
        item,
        detFacts,
        detCite,
        detRefusal,
      };
    });

    const judgePrompt = `
Evaluate these ${batchItems.length} test case responses strictly using the rubric. Do NOT reward verbosity. Penalize ungrounded claims.

${batchItems
  .map(
    (b, idx) => `=== CASE ${idx + 1}: ${b.item.tc.test_id} (${b.item.tc.category}) ===
Question: ${b.item.tc.question}
Expected Refusal: ${b.item.tc.expected_refusal}
Expected Facts: ${JSON.stringify(b.item.tc.expected_facts)}
Expected Source Docs: ${JSON.stringify(b.item.tc.expected_source_documents)}
Deterministic Signals -> FactOverlap: ${b.detFacts.matched}/${b.detFacts.total}, CitationMatch: ${b.detCite.score}, RefusalDetected: ${b.detRefusal}
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
      const llmEval = evalMap.get(b.item.tc.test_id);
      const grounding = clamp01(llmEval?.grounding ?? (b.detRefusal && b.item.tc.expected_refusal ? 1 : 0.7));
      // Combine deterministic fact match with LLM correctness to prevent fluency/verbosity bias
      const rawCorrectness = clamp01(llmEval?.correctness ?? b.detFacts.ratio);
      const correctness = b.item.tc.expected_refusal
        ? b.detRefusal
          ? 1
          : 0
        : Number((0.45 * b.detFacts.ratio + 0.55 * rawCorrectness).toFixed(2));

      const refusal_accuracy =
        b.item.tc.expected_refusal === b.detRefusal
          ? 1
          : clamp01(llmEval?.refusal_accuracy ?? 0);

      const citation_accuracy = b.item.tc.expected_refusal
        ? 1
        : Number((0.5 * b.detCite.score + 0.5 * clamp01(llmEval?.citation_accuracy ?? b.detCite.score)).toFixed(2));

      const relevance = clamp01(llmEval?.relevance ?? 0.8);

      const overall = Number(
        (
          0.25 * grounding +
          0.3 * correctness +
          0.2 * refusal_accuracy +
          0.15 * citation_accuracy +
          0.1 * relevance
        ).toFixed(2)
      );

      // Strict deterministic refusal override
      let passed = (llmEval?.passed ?? overall >= 0.75) && overall >= 0.7;
      let failure_category: FailureCategory = llmEval?.failure_category ?? 'none';
      let failure_explanation = llmEval?.failure_explanation ?? '';

      if (b.item.tc.expected_refusal && !b.detRefusal && refusal_accuracy < 0.7) {
        passed = false;
        failure_category = 'wrong_refusal';
        failure_explanation =
          failure_explanation || 'Agent failed to refuse an out-of-scope or unsupported question.';
      } else if (!b.item.tc.expected_refusal && b.detRefusal) {
        passed = false;
        failure_category = 'wrong_refusal';
        failure_explanation =
          failure_explanation || 'Agent wrongly refused an answerable question supported by documents.';
      }

      if (passed) {
        failure_category = 'none';
        failure_explanation = 'Passed all grounding, factual, refusal, and citation checks.';
      } else if (failure_category === 'none') {
        failure_category =
          citation_accuracy < 0.6
            ? 'incorrect_citation'
            : grounding < 0.6
            ? 'hallucination'
            : b.item.retrieved_evidence.length === 0
            ? 'retrieval_miss'
            : 'incomplete_answer';
      }

      results.push({
        test_id: b.item.tc.test_id,
        question: b.item.tc.question,
        category: b.item.tc.category,
        expected_refusal: b.item.tc.expected_refusal,
        expected_facts: b.item.tc.expected_facts,
        expected_source_documents: b.item.tc.expected_source_documents,
        agent_response: b.item.answer,
        retrieved_evidence: b.item.retrieved_evidence,
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
        tool_calls_used: b.item.tool_calls_used,
      });
    }
  }

  return results;
}

function clamp01(val: number): number {
  if (Number.isNaN(val)) return 0;
  return Math.max(0, Math.min(1, Number(val.toFixed(2))));
}
