import { Type } from '@google/genai';
import type {
  ClarificationTurn,
  DocumentChunk,
  DocumentFile,
  RequirementsSpec,
  ToolId,
} from '../../src/types/forge.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';

export interface IntakeQuestionResult {
  questions: string[];
  preliminary_notes: string;
}

export async function generateClarificationQuestions(params: {
  brief: string;
  additional_requirements?: string;
  documents: DocumentFile[];
  chunks: DocumentChunk[];
  tracker?: BudgetTracker;
}): Promise<IntakeQuestionResult> {
  const docInventory = params.documents
    .filter((d) => d.status === 'processed')
    .map(
      (d) =>
        `- ${d.filename} (${d.file_type.toUpperCase()}, ${d.page_or_row_count} segments): ${d.preview_text.slice(0, 260)}`
    )
    .join('\n');

  const systemInstruction = loadPromptTemplate('intake_prompt.txt');
  const prompt = `
Brief: ${params.brief}
Additional requirements: ${params.additional_requirements || 'None provided'}

Uploaded document inventory:
${docInventory || 'No valid documents uploaded.'}

Determine if any critical ambiguities remain before building the agent (audience, tone, refusal boundaries, calculation rules, or handling of topics missing from the uploaded documents).
Return between 0 and 5 concise, high-value clarification questions. If the brief and documents already make everything unambiguous, return an empty array [].
`;

  const res = await generateStructuredJson<IntakeQuestionResult>({
    systemInstruction,
    prompt,
    tracker: params.tracker,
    lowThinking: true,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Maximum 5 concise clarification questions.',
        },
        preliminary_notes: {
          type: Type.STRING,
          description: 'Initial observations about document coverage vs brief.',
        },
      },
      required: ['questions', 'preliminary_notes'],
    },
  });

  return {
    questions: (res.questions ?? []).slice(0, 5),
    preliminary_notes: res.preliminary_notes ?? '',
  };
}

function enforceStrictToolSelection(
  candidateTools: string[],
  brief: string,
  additionalReq: string | undefined,
  documents: DocumentFile[]
): ToolId[] {
  const combined = `${brief} ${additionalReq ?? ''}`.toLowerCase();
  const hasCsv = documents.some((d) => d.status === 'processed' && d.file_type === 'csv');
  const validSet = new Set<ToolId>();

  for (const t of candidateTools) {
    if (t === 'csv_lookup' && hasCsv) validSet.add('csv_lookup');
    if (
      t === 'calculator' &&
      /\b(calculat|total|sum|price|cost|discount|budget|math|percent|rate|quantit|quote|amount|compare)\b/.test(
        combined
      )
    ) {
      validSet.add('calculator');
    }
    if (
      t === 'public_weather' &&
      /\b(weather|forecast|temperature|rain|wind|climate|meteorolog)\b/.test(combined)
    ) {
      validSet.add('public_weather');
    }
    if (
      t === 'current_date' &&
      /\b(today|current date|deadline|expir|schedule|effective date|date)\b/.test(combined)
    ) {
      validSet.add('current_date');
    }
  }

  // Also add deterministic positive matches if CSV + math are clearly needed
  if (hasCsv && /\b(catalogue|catalog|part|sku|lookup|supplier|table|csv|row|inventory|spare)\b/.test(combined)) {
    validSet.add('csv_lookup');
  }

  return Array.from(validSet);
}

export async function synthesizeRequirementsSpec(params: {
  agent_id: string;
  brief: string;
  additional_requirements?: string;
  documents: DocumentFile[];
  chunks: DocumentChunk[];
  clarification_history: ClarificationTurn[];
  tracker?: BudgetTracker;
}): Promise<RequirementsSpec> {
  const docSummaries = params.documents
    .filter((d) => d.status === 'processed')
    .map((d) => {
      const sampleChunks = params.chunks
        .filter((c) => c.document_name === d.filename)
        .slice(0, 3)
        .map((c) => `[${c.page_or_row}] ${c.source_text.slice(0, 260)}`)
        .join('\n');
      return `Document: ${d.filename} (${d.file_type.toUpperCase()})\n${sampleChunks}`;
    })
    .join('\n\n');

  const qaText =
    params.clarification_history.length > 0
      ? params.clarification_history
          .map((turn, idx) => `Q${idx + 1}: ${turn.question}\nA${idx + 1}: ${turn.answer}`)
          .join('\n')
      : 'No clarification questions were needed.';

  const systemInstruction = loadPromptTemplate('intake_prompt.txt');
  const prompt = `
Create a structured RequirementsSpec from the following inputs.

Original Brief:
${params.brief}

Additional Requirements:
${params.additional_requirements || 'None'}

Clarification Dialogue:
${qaText}

Uploaded Documents & Samples:
${docSummaries}

Available Tool IDs (attach ONLY if genuinely required by the brief and available data):
- "csv_lookup": structured CSV row search
- "calculator": numeric/discount/cost arithmetic
- "public_weather": live Open-Meteo weather forecasts (ONLY if weather is requested)
- "current_date": current calendar date checks

Produce complete fields including supported_topics, unsupported_topics (anything asked in brief not found in documents), must_answer_topics, must_refuse_topics, and limitations.
`;

  const raw = await generateStructuredJson<{
    agent_name: string;
    agent_purpose: string;
    scope: string;
    target_audience: string;
    tone: string;
    must_answer_topics: string[];
    must_refuse_topics: string[];
    supported_topics: string[];
    unsupported_topics: string[];
    required_tools: string[];
    limitations: string[];
  }>({
    systemInstruction,
    prompt,
    tracker: params.tracker,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        agent_name: { type: Type.STRING },
        agent_purpose: { type: Type.STRING },
        scope: { type: Type.STRING },
        target_audience: { type: Type.STRING },
        tone: { type: Type.STRING },
        must_answer_topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        must_refuse_topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        supported_topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        unsupported_topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        required_tools: { type: Type.ARRAY, items: { type: Type.STRING } },
        limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'agent_name',
        'agent_purpose',
        'scope',
        'target_audience',
        'tone',
        'must_answer_topics',
        'must_refuse_topics',
        'supported_topics',
        'unsupported_topics',
        'required_tools',
        'limitations',
      ],
    },
  });

  const strictTools = enforceStrictToolSelection(
    raw.required_tools ?? [],
    params.brief,
    params.additional_requirements,
    params.documents
  );

  return {
    agent_id: params.agent_id,
    original_brief: params.brief,
    additional_requirements: params.additional_requirements,
    agent_name: raw.agent_name,
    agent_purpose: raw.agent_purpose,
    scope: raw.scope,
    target_audience: raw.target_audience,
    tone: raw.tone,
    must_answer_topics: raw.must_answer_topics ?? [],
    must_refuse_topics: raw.must_refuse_topics ?? [],
    supported_topics: raw.supported_topics ?? [],
    unsupported_topics: raw.unsupported_topics ?? [],
    required_tools: strictTools,
    limitations: raw.limitations ?? [],
    clarification_history: params.clarification_history,
    approved: false,
    created_at: new Date().toISOString(),
  };
}
