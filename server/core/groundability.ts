import { Type } from '@google/genai';
import type {
  DocumentChunk,
  GroundabilityReport,
  GroundabilityStatus,
  GroundabilityTopicCheck,
  RequirementsSpec,
} from '../../src/types/forge.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';
import { retrieveRelevantChunks } from './retrieval.ts';

export async function runGroundabilityGuard(params: {
  requirements: RequirementsSpec;
  chunks: DocumentChunk[];
  tracker?: BudgetTracker;
}): Promise<GroundabilityReport> {
  const topics = Array.from(
    new Set([
      ...params.requirements.must_answer_topics,
      ...params.requirements.unsupported_topics,
    ])
  ).filter(Boolean);

  if (topics.length === 0) {
    topics.push(params.requirements.agent_purpose);
  }

  const evidenceBundle: Array<{ topic: string; snippets: string[] }> = [];
  for (const topic of topics.slice(0, 12)) {
    const retrieved = await retrieveRelevantChunks({
      query: topic,
      chunks: params.chunks,
      config: {
        chunk_size: 700,
        chunk_overlap: 120,
        top_k: 4,
        similarity_threshold: 0.15,
      },
      tracker: params.tracker,
      useEmbeddings: false,
    });
    evidenceBundle.push({
      topic,
      snippets: retrieved.map(
        (r) => `[${r.document_name}, ${r.page_or_row}] (score ${r.similarity_score}): ${r.source_text.slice(0, 320)}`
      ),
    });
  }

  const systemInstruction = loadPromptTemplate('groundability_prompt.txt');
  const prompt = `
Original Brief: ${params.requirements.original_brief}
Agent Scope: ${params.requirements.scope}

Topics and Retrieved Document Evidence:
${evidenceBundle
  .map(
    (b) =>
      `TOPIC: "${b.topic}"\nEVIDENCE:\n${
        b.snippets.length > 0 ? b.snippets.join('\n') : 'No matching chunks retrieved from uploaded documents.'
      }`
  )
  .join('\n\n')}

Classify each topic strictly as one of:
"Fully supported", "Partially supported", "Not supported", or "Conflicting information".
If a topic is "Not supported" or "Partially supported", clearly state what is missing so the agent refuses unsupported claims rather than hallucinating.
`;

  const res = await generateStructuredJson<{
    checks: Array<{
      topic: string;
      status: GroundabilityStatus;
      evidence: string[];
      source_documents: string[];
      explanation: string;
    }>;
    flagged_gaps: string[];
    warnings: string[];
  }>({
    systemInstruction,
    prompt,
    tracker: params.tracker,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        checks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              status: {
                type: Type.STRING,
                enum: [
                  'Fully supported',
                  'Partially supported',
                  'Not supported',
                  'Conflicting information',
                ],
              },
              evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
              source_documents: { type: Type.ARRAY, items: { type: Type.STRING } },
              explanation: { type: Type.STRING },
            },
            required: ['topic', 'status', 'evidence', 'source_documents', 'explanation'],
          },
        },
        flagged_gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
        warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['checks', 'flagged_gaps', 'warnings'],
    },
  });

  const checks: GroundabilityTopicCheck[] = res.checks ?? [];
  const total = Math.max(1, checks.length);
  const weightSum = checks.reduce((sum, c) => {
    if (c.status === 'Fully supported') return sum + 1;
    if (c.status === 'Partially supported') return sum + 0.5;
    if (c.status === 'Conflicting information') return sum + 0.25;
    return sum;
  }, 0);

  return {
    agent_id: params.requirements.agent_id,
    overall_groundability_pct: Math.round((weightSum / total) * 100),
    checks,
    flagged_gaps: res.flagged_gaps ?? [],
    warnings: res.warnings ?? [],
    generated_at: new Date().toISOString(),
  };
}
