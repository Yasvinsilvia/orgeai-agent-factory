import type { Content } from '@google/genai';
import type {
  AgentDefinition,
  DocumentChunk,
  RetrievedChunk,
  ToolExecutionLog,
  ToolId,
  TrustLedgerEntry,
} from '../../src/types/forge.ts';
import { BudgetTracker, getGeminiClient } from './gemini.ts';
import { retrieveRelevantChunks } from './retrieval.ts';
import {
  executeRegisteredTool,
  getFunctionDeclarationsForTools,
  type CsvTableSource,
} from './tools.ts';
import { verifyAnswerWithTrustLedger } from './trustLedger.ts';

export interface AgentTurnInput {
  agent: AgentDefinition;
  question: string;
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  tracker?: BudgetTracker;
  useEmbeddings?: boolean;
  skipTrustLlmCheck?: boolean;
}

export interface AgentTurnOutput {
  answer: string;
  retrieved_evidence: RetrievedChunk[];
  tool_executions: ToolExecutionLog[];
  trust_ledger: TrustLedgerEntry;
}

export async function runAgentTurn(params: AgentTurnInput): Promise<AgentTurnOutput> {
  const start = Date.now();
  const ai = getGeminiClient();

  const retrieved = await retrieveRelevantChunks({
    query: params.question,
    chunks: params.chunks,
    config: params.agent.retrieval_config,
    tracker: params.tracker,
    useEmbeddings: params.useEmbeddings ?? false,
  });

  const evidenceContext =
    retrieved.length > 0
      ? retrieved
          .map(
            (c, idx) =>
              `[Evidence ${idx + 1} | Document: ${c.document_name} | Location: ${c.page_or_row} | Similarity: ${c.similarity_score}]\n${c.source_text}`
          )
          .join('\n\n')
      : 'NO RELEVANT DOCUMENT EVIDENCE FOUND.';

  const systemInstruction = `
${params.agent.system_prompt}

--- RUNTIME CONTRACT ---
Target Audience: ${params.agent.target_audience}
Tone: ${params.agent.tone}
Citation Requirement: ${params.agent.source_citation_requirements}
Output Contract: ${params.agent.output_contract}
Refusal Rules:
${params.agent.refusal_rules.map((r) => `- ${r}`).join('\n')}

CRITICAL GROUNDING RULES:
1. Answer STRICTLY using the Retrieved Evidence below and outputs from your attached tools.
2. NEVER invent facts, figures, or policies using outside general knowledge.
3. Cite sources inline as [DocumentName, Page/Row].
4. If the retrieved evidence does not contain the answer or the question falls under refusal rules, clearly refuse and state what is missing from the uploaded documents.
`;

  const historyContents: Content[] = (params.history ?? []).slice(-6).map((h) => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  const userPayload = `User Question: ${params.question}

Retrieved Evidence:
${evidenceContext}`;

  const contents: Content[] = [
    ...historyContents,
    { role: 'user', parts: [{ text: userPayload }] },
  ];

  const functionDeclarations = getFunctionDeclarationsForTools(params.agent.selected_tools);
  const toolsConfig = functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

  const tool_executions: ToolExecutionLog[] = [];
  let finalAnswer = '';

  for (let round = 0; round < 3; round++) {
    const callStart = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        ...(toolsConfig ? { tools: toolsConfig } : {}),
      },
    });
    const respText = (response.text ?? '').trim();
    params.tracker?.recordLlm(
      systemInstruction.length + JSON.stringify(contents).length,
      respText.length,
      Date.now() - callStart
    );

    const fCalls = response.functionCalls;
    const modelContent = response.candidates?.[0]?.content;
    if (!fCalls || fCalls.length === 0 || !modelContent) {
      finalAnswer = respText;
      break;
    }

    contents.push(modelContent);
    const fnResponses: Array<{
      functionResponse: { id?: string; name: string; response: { result: string } };
    }> = [];

    for (const fc of fCalls) {
      const toolName = fc.name as ToolId;
      if (!params.agent.selected_tools.includes(toolName)) {
        fnResponses.push({
          functionResponse: {
            id: fc.id,
            name: fc.name ?? 'unknown',
            response: { result: JSON.stringify({ error: 'Tool is not attached to this agent.' }) },
          },
        });
        continue;
      }
      const args = (fc.args ?? {}) as Record<string, unknown>;
      const resultStr = await executeRegisteredTool({
        toolId: toolName,
        args,
        csvSources: params.csvSources,
      });
      tool_executions.push({
        tool: toolName,
        arguments: args,
        result_summary: resultStr.slice(0, 400),
      });
      fnResponses.push({
        functionResponse: {
          id: fc.id,
          name: toolName,
          response: { result: resultStr },
        },
      });
    }

    contents.push({
      role: 'user',
      parts: fnResponses,
    });
  }

  if (!finalAnswer) {
    finalAnswer =
      'I could not complete a grounded answer from the uploaded documents. Please refine your query or upload relevant supporting documentation.';
  }

  const latency_ms = Date.now() - start;
  const trust_ledger = await verifyAnswerWithTrustLedger({
    agent_id: params.agent.id,
    question: params.question,
    answer: finalAnswer,
    retrieved_evidence: retrieved,
    tool_executions,
    latency_ms,
    tracker: params.tracker,
    skipLlmCheck: params.skipTrustLlmCheck,
  });

  return {
    answer: finalAnswer,
    retrieved_evidence: retrieved,
    tool_executions,
    trust_ledger,
  };
}
