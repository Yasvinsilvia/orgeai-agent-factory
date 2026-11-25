import { Type } from '@google/genai';
import type {
  AgentDefinition,
  DocumentFile,
  GroundabilityReport,
  PromptCandidateResult,
  RequirementsSpec,
} from '../../src/types/forge.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';

export async function generateAgentDefinition(params: {
  requirements: RequirementsSpec;
  groundability: GroundabilityReport;
  documents: DocumentFile[];
  tracker?: BudgetTracker;
}): Promise<AgentDefinition> {
  const hasCsv = params.documents.some((d) => d.status === 'processed' && d.file_type === 'csv');
  const systemInstruction = loadPromptTemplate('agent_generation_prompt.txt');

  const prompt = `
RequirementsSpec:
${JSON.stringify(params.requirements, null, 2)}

GroundabilityReport:
${JSON.stringify(params.groundability, null, 2)}

Document Types Uploaded: ${params.documents.map((d) => `${d.filename} (${d.file_type})`).join(', ')}

Generate a complete, declarative AgentDefinition.
- Ensure selected_tools contains ONLY tools from requirements.required_tools: ${JSON.stringify(
    params.requirements.required_tools
  )}.
- Set retrieval_config appropriately (${
    hasCsv ? 'CSV present: chunk_size around 500-650, top_k 5-6' : 'Policy/prose docs: chunk_size around 650-850, top_k 4-5'
  }, similarity_threshold between 0.18 and 0.30).
- Embed explicit refusal rules for every Not Supported / flagged gap in GroundabilityReport and must_refuse_topics.
- Require inline citations formatted as [DocumentName, Page/Row].
`;

  const raw = await generateStructuredJson<{
    agent_name: string;
    description: string;
    system_prompt: string;
    refusal_rules: string[];
    retrieval_config: {
      chunk_size: number;
      chunk_overlap: number;
      top_k: number;
      similarity_threshold: number;
    };
    output_contract: string;
    source_citation_requirements: string;
    known_limitations: string[];
  }>({
    systemInstruction,
    prompt,
    tracker: params.tracker,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        agent_name: { type: Type.STRING },
        description: { type: Type.STRING },
        system_prompt: { type: Type.STRING },
        refusal_rules: { type: Type.ARRAY, items: { type: Type.STRING } },
        retrieval_config: {
          type: Type.OBJECT,
          properties: {
            chunk_size: { type: Type.INTEGER },
            chunk_overlap: { type: Type.INTEGER },
            top_k: { type: Type.INTEGER },
            similarity_threshold: { type: Type.NUMBER },
          },
          required: ['chunk_size', 'chunk_overlap', 'top_k', 'similarity_threshold'],
        },
        output_contract: { type: Type.STRING },
        source_citation_requirements: { type: Type.STRING },
        known_limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'agent_name',
        'description',
        'system_prompt',
        'refusal_rules',
        'retrieval_config',
        'output_contract',
        'source_citation_requirements',
        'known_limitations',
      ],
    },
  });

  const now = new Date().toISOString();
  return {
    id: params.requirements.agent_id,
    agent_name: raw.agent_name || params.requirements.agent_name,
    description: raw.description,
    system_prompt: raw.system_prompt,
    target_audience: params.requirements.target_audience,
    tone: params.requirements.tone,
    supported_topics: params.requirements.supported_topics,
    refusal_rules: raw.refusal_rules ?? params.requirements.must_refuse_topics,
    retrieval_config: {
      chunk_size: Math.max(300, Math.min(1400, raw.retrieval_config?.chunk_size || 700)),
      chunk_overlap: Math.max(60, Math.min(300, raw.retrieval_config?.chunk_overlap || 120)),
      top_k: Math.max(3, Math.min(8, raw.retrieval_config?.top_k || 4)),
      similarity_threshold: Math.max(
        0.1,
        Math.min(0.6, raw.retrieval_config?.similarity_threshold || 0.22)
      ),
    },
    selected_tools: params.requirements.required_tools,
    output_contract: raw.output_contract,
    source_citation_requirements: raw.source_citation_requirements,
    known_limitations: Array.from(
      new Set([
        ...(raw.known_limitations ?? []),
        ...params.groundability.flagged_gaps,
      ])
    ),
    version: 1,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
}

export async function generatePromptTournamentCandidates(params: {
  baseAgent: AgentDefinition;
  requirements: RequirementsSpec;
  tracker?: BudgetTracker;
}): Promise<Array<{ candidate_id: string; label: string; strategy: string; system_prompt: string }>> {
  const prompt = `
Produce 3 distinct candidate system prompts for this agent to compete in a Prompt Tournament:
1. "Strict Evidence-First": Minimal, rigid citation-per-sentence and zero-extrapolation refusal posture.
2. "Structured Analyst": Step-by-step synthesis checklist covering multi-document facts + explicit gap boundary.
3. "Balanced Concise": High-precision direct answers with explicit [Doc, Page/Row] tags and clear refusal template.

Base Agent Name: ${params.baseAgent.agent_name}
Purpose: ${params.requirements.agent_purpose}
Supported Topics: ${params.requirements.supported_topics.join(', ')}
Refusal Rules: ${params.baseAgent.refusal_rules.join('; ')}
Tools Attached: ${params.baseAgent.selected_tools.join(', ') || 'None'}
`;

  const res = await generateStructuredJson<{
    candidates: Array<{
      candidate_id: string;
      label: string;
      strategy: string;
      system_prompt: string;
    }>;
  }>({
    prompt,
    tracker: params.tracker,
    lowThinking: true,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        candidates: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              candidate_id: { type: Type.STRING },
              label: { type: Type.STRING },
              strategy: { type: Type.STRING },
              system_prompt: { type: Type.STRING },
            },
            required: ['candidate_id', 'label', 'strategy', 'system_prompt'],
          },
        },
      },
      required: ['candidates'],
    },
  });

  return (res.candidates ?? []).slice(0, 3);
}

export type { PromptCandidateResult };
