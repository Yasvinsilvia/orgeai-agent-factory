import { Type } from '@google/genai';
import type {
  AgentDefinition,
  DocumentChunk,
  EvalTestCase,
  GroundabilityReport,
  RequirementsSpec,
} from '../../src/types/forge.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';

function validateTestCases(cases: EvalTestCase[]): EvalTestCase[] {
  const seenIds = new Set<string>();
  const seenQuestions = new Set<string>();
  const valid: EvalTestCase[] = [];

  for (const tc of cases) {
    if (!tc.question || tc.question.trim().length < 10) continue;
    const normQ = tc.question.trim().toLowerCase();
    if (seenQuestions.has(normQ)) continue;

    if (!['answerable', 'out_of_scope', 'edge_case'].includes(tc.category)) continue;
    if (tc.category === 'answerable' && !tc.expected_refusal && (!tc.expected_facts || tc.expected_facts.length === 0)) {
      continue;
    }
    if (tc.category === 'out_of_scope' && !tc.expected_refusal) {
      tc.expected_refusal = true;
    }

    const id = tc.test_id && !seenIds.has(tc.test_id)
      ? tc.test_id
      : `EVAL-${String(valid.length + 1).padStart(2, '0')}`;
    seenIds.add(id);
    seenQuestions.add(normQ);

    valid.push({
      ...tc,
      test_id: id,
      expected_facts: tc.expected_facts ?? [],
      expected_source_documents: tc.expected_source_documents ?? [],
      difficulty: ['easy', 'medium', 'hard'].includes(tc.difficulty) ? tc.difficulty : 'medium',
    });
  }

  return valid;
}

export async function generateEvaluationSuite(params: {
  agent: AgentDefinition;
  requirements: RequirementsSpec;
  groundability: GroundabilityReport;
  chunks: DocumentChunk[];
  tracker?: BudgetTracker;
}): Promise<EvalTestCase[]> {
  const systemInstruction = loadPromptTemplate('eval_generation_prompt.txt');

  // Sample diverse chunks across all documents so multi-document questions are grounded
  const byDoc = new Map<string, DocumentChunk[]>();
  for (const c of params.chunks) {
    const arr = byDoc.get(c.document_name) ?? [];
    arr.push(c);
    byDoc.set(c.document_name, arr);
  }

  const sampledText: string[] = [];
  for (const [docName, docChunks] of byDoc.entries()) {
    const step = Math.max(1, Math.floor(docChunks.length / 6));
    for (let i = 0; i < docChunks.length && sampledText.length < 24; i += step) {
      const c = docChunks[i];
      sampledText.push(`[${docName}, ${c.page_or_row}]\n${c.source_text.slice(0, 520)}`);
    }
  }

  const prompt = `
Agent Name: ${params.agent.agent_name}
Purpose: ${params.requirements.agent_purpose}
Supported Topics: ${params.requirements.supported_topics.join(', ')}
Unsupported / Flagged Gap Topics (MUST be tested as out_of_scope refusals): ${[
    ...params.requirements.must_refuse_topics,
    ...params.groundability.flagged_gaps,
  ].join('; ')}
Attached Tools: ${params.agent.selected_tools.join(', ') || 'None'}

Grounded Document Excerpts:
${sampledText.join('\n\n---\n\n')}

Generate 22 distinct evaluation test cases:
- 10 "answerable" (including multi-section and cross-document questions using exact facts from the excerpts above)
- 6 "out_of_scope" (testing flagged gaps, unsupported topics, and unrelated domains; expected_refusal=true)
- 6 "edge_case" (ambiguous phrasing, false premise contradicting the docs, boundary values, or multi-step tool/document synthesis)

Every answerable case MUST list exact verbatim expected_facts and expected_source_documents from the excerpts above.
`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      test_cases: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            test_id: { type: Type.STRING },
            question: { type: Type.STRING },
            category: { type: Type.STRING, enum: ['answerable', 'out_of_scope', 'edge_case'] },
            subcategory: { type: Type.STRING },
            expected_behavior: { type: Type.STRING },
            expected_facts: { type: Type.ARRAY, items: { type: Type.STRING } },
            expected_source_documents: { type: Type.ARRAY, items: { type: Type.STRING } },
            expected_refusal: { type: Type.BOOLEAN },
            difficulty: { type: Type.STRING, enum: ['easy', 'medium', 'hard'] },
          },
          required: [
            'test_id',
            'question',
            'category',
            'subcategory',
            'expected_behavior',
            'expected_facts',
            'expected_source_documents',
            'expected_refusal',
            'difficulty',
          ],
        },
      },
    },
    required: ['test_cases'],
  };

  const raw = await generateStructuredJson<{ test_cases: EvalTestCase[] }>({
    systemInstruction,
    prompt,
    tracker: params.tracker,
    responseSchema,
  });

  let validated = validateTestCases(raw.test_cases ?? []);

  // Guarantee minimum 20 validated cases with a top-up pass if validation pruned any
  if (validated.length < 20) {
    const needed = 22 - validated.length;
    const topUp = await generateStructuredJson<{ test_cases: EvalTestCase[] }>({
      systemInstruction,
      prompt: `${prompt}\n\nGenerate ${needed} additional unique test cases not overlapping with: ${validated
        .map((v) => v.question)
        .join(' | ')}`,
      tracker: params.tracker,
      responseSchema,
    });
    validated = validateTestCases([...validated, ...(topUp.test_cases ?? [])]);
  }

  return validated.map((tc, idx) => ({
    ...tc,
    test_id: `EVAL-${String(idx + 1).padStart(2, '0')}`,
  }));
}
