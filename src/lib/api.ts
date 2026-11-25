import type {
  AgentWorkspaceBundle,
  ClarificationTurn,
  DashboardMetrics,
  DocumentFile,
  GroundabilityReport,
  HumanBaselineComparison,
  RegressionResult,
  RequirementsSpec,
  RetrievedChunk,
  ToolExecutionLog,
  TrustLedgerEntry,
} from '../types/forge';

export interface ToolRegistryInfo {
  id: string;
  name: string;
  description: string;
  when_to_attach: string;
}

export interface DashboardPayload {
  metrics: DashboardMetrics;
  agents: AgentWorkspaceBundle[];
  tool_registry: ToolRegistryInfo[];
}

export interface ChunkPreview {
  chunk_id: string;
  agent_id: string;
  document_name: string;
  file_type: 'pdf' | 'docx' | 'txt' | 'csv';
  page_or_row: string;
  source_text: string;
  char_count: number;
  has_embedding: boolean;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export async function fetchDashboard(agentId?: string): Promise<DashboardPayload> {
  const url = agentId ? `/api/dashboard?agentId=${encodeURIComponent(agentId)}` : '/api/dashboard';
  const res = await fetch(url);
  return handleJson<DashboardPayload>(res);
}

export async function fetchAgentChunks(agentId: string): Promise<ChunkPreview[]> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chunks`);
  return handleJson<ChunkPreview[]>(res);
}

export async function uploadAndStartIntake(params: {
  brief: string;
  additional_requirements?: string;
  files: File[];
}): Promise<{
  agent_id: string;
  documents: DocumentFile[];
  chunks_count: number;
  questions: string[];
  preliminary_notes: string;
}> {
  const form = new FormData();
  form.append('brief', params.brief);
  if (params.additional_requirements) {
    form.append('additional_requirements', params.additional_requirements);
  }
  for (const file of params.files) {
    form.append('files', file);
  }
  const res = await fetch('/api/factory/upload-and-intake', {
    method: 'POST',
    body: form,
  });
  return handleJson(res);
}

export async function finalizeRequirements(params: {
  agent_id: string;
  brief: string;
  additional_requirements?: string;
  clarification_history: ClarificationTurn[];
}): Promise<{
  requirements: RequirementsSpec;
  groundability: GroundabilityReport;
}> {
  const res = await fetch(`/api/factory/${encodeURIComponent(params.agent_id)}/finalize-requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brief: params.brief,
      additional_requirements: params.additional_requirements,
      clarification_history: params.clarification_history,
    }),
  });
  return handleJson(res);
}

export async function approveRequirements(
  agentId: string,
  requirements: RequirementsSpec
): Promise<{ requirements: RequirementsSpec; groundability: GroundabilityReport }> {
  const res = await fetch(`/api/factory/${encodeURIComponent(agentId)}/requirements`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requirements),
  });
  return handleJson(res);
}

export async function generateAndOptimizeAgent(params: {
  agent_id: string;
  enable_prompt_tournament: boolean;
  max_iterations: number;
}): Promise<AgentWorkspaceBundle> {
  const res = await fetch(`/api/factory/${encodeURIComponent(params.agent_id)}/generate-and-optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enable_prompt_tournament: params.enable_prompt_tournament,
      max_iterations: params.max_iterations,
    }),
  });
  return handleJson(res);
}

export async function reEvaluateAgent(agentId: string, maxIterations = 2): Promise<AgentWorkspaceBundle> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/re-evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_iterations: maxIterations }),
  });
  return handleJson(res);
}

export async function runRegressionUpload(
  agentId: string,
  files: File[]
): Promise<{ regression: RegressionResult; bundle: AgentWorkspaceBundle }> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/regression`, {
    method: 'POST',
    body: form,
  });
  return handleJson(res);
}

export async function sendPlaygroundMessage(params: {
  agent_id: string;
  question: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}): Promise<{
  answer: string;
  retrieved_evidence: RetrievedChunk[];
  tool_executions: ToolExecutionLog[];
  trust_ledger: TrustLedgerEntry;
}> {
  const res = await fetch(`/api/agents/${encodeURIComponent(params.agent_id)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: params.question,
      history: params.history,
    }),
  });
  return handleJson(res);
}

export async function compareWithHumanBaseline(
  agentId: string,
  humanSystemPrompt?: string
): Promise<{ comparison: HumanBaselineComparison; bundle: AgentWorkspaceBundle }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/compare-baseline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ human_system_prompt: humanSystemPrompt }),
  });
  return handleJson(res);
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
  await handleJson(res);
}
