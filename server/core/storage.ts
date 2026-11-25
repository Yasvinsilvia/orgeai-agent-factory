import fs from 'fs';
import path from 'path';
import type {
  AgentDefinition,
  AgentWorkspaceBundle,
  DashboardMetrics,
  DocumentChunk,
  DocumentFile,
  EvalCaseResult,
  EvalTestCase,
  GroundabilityReport,
  HumanBaselineComparison,
  OptimizationIteration,
  QualityReport,
  RegressionResult,
  RequirementsSpec,
  TrustLedgerEntry,
} from '../../src/types/forge.ts';
import type { CsvTableSource } from './tools.ts';

const ROOT_DATA_DIR = path.resolve(process.cwd(), 'forgeai_data');

const SUBDIRS = [
  'uploads',
  'vectorstores',
  'generated_agents',
  'evaluations',
  'reports',
  'trust_ledger',
  'requirements',
  'groundability',
  'regressions',
  'baselines',
] as const;

export function ensureDataDirectories() {
  if (!fs.existsSync(ROOT_DATA_DIR)) {
    fs.mkdirSync(ROOT_DATA_DIR, { recursive: true });
  }
  for (const sub of SUBDIRS) {
    const dir = path.join(ROOT_DATA_DIR, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath: string, data: unknown) {
  ensureDataDirectories();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Raw uploaded file persistence
export function saveUploadedRawFile(agentId: string, filename: string, buffer: Buffer) {
  ensureDataDirectories();
  const dir = path.join(ROOT_DATA_DIR, 'uploads', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, path.basename(filename)), buffer);
}

export function loadCsvSourcesForAgent(agentId: string): CsvTableSource[] {
  const dir = path.join(ROOT_DATA_DIR, 'uploads', agentId);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const sources: CsvTableSource[] = [];
  for (const name of entries) {
    if (name.toLowerCase().endsWith('.csv')) {
      const rawCsv = fs.readFileSync(path.join(dir, name), 'utf-8');
      sources.push({ filename: name, rawCsv });
    }
  }
  return sources;
}

export function saveDocumentsMetadata(agentId: string, docs: DocumentFile[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'uploads', `${agentId}_docs.json`), docs);
}

export function loadDocumentsMetadata(agentId: string): DocumentFile[] {
  return readJsonSafe<DocumentFile[]>(path.join(ROOT_DATA_DIR, 'uploads', `${agentId}_docs.json`), []);
}

export function saveChunks(agentId: string, chunks: DocumentChunk[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'vectorstores', `${agentId}_chunks.json`), chunks);
}

export function loadChunks(agentId: string): DocumentChunk[] {
  return readJsonSafe<DocumentChunk[]>(path.join(ROOT_DATA_DIR, 'vectorstores', `${agentId}_chunks.json`), []);
}

export function saveRequirements(agentId: string, req: RequirementsSpec) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'requirements', `${agentId}.json`), req);
}

export function loadRequirements(agentId: string): RequirementsSpec | null {
  return readJsonSafe<RequirementsSpec | null>(path.join(ROOT_DATA_DIR, 'requirements', `${agentId}.json`), null);
}

export function saveGroundability(agentId: string, report: GroundabilityReport) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'groundability', `${agentId}.json`), report);
}

export function loadGroundability(agentId: string): GroundabilityReport | null {
  return readJsonSafe<GroundabilityReport | null>(
    path.join(ROOT_DATA_DIR, 'groundability', `${agentId}.json`),
    null
  );
}

export function saveAgentDefinition(agent: AgentDefinition) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'generated_agents', `${agent.id}.json`), agent);
}

export function loadAgentDefinition(agentId: string): AgentDefinition | null {
  return readJsonSafe<AgentDefinition | null>(
    path.join(ROOT_DATA_DIR, 'generated_agents', `${agentId}.json`),
    null
  );
}

export function saveEvalDataset(agentId: string, cases: EvalTestCase[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_dataset.json`), cases);
}

export function loadEvalDataset(agentId: string): EvalTestCase[] {
  return readJsonSafe<EvalTestCase[]>(path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_dataset.json`), []);
}

export function saveEvalResults(agentId: string, results: EvalCaseResult[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_results.json`), results);
}

export function loadEvalResults(agentId: string): EvalCaseResult[] {
  return readJsonSafe<EvalCaseResult[]>(path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_results.json`), []);
}

export function saveOptimizationLogs(agentId: string, logs: OptimizationIteration[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_opt_logs.json`), logs);
}

export function loadOptimizationLogs(agentId: string): OptimizationIteration[] {
  return readJsonSafe<OptimizationIteration[]>(
    path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_opt_logs.json`),
    []
  );
}

export function saveQualityReport(agentId: string, report: QualityReport) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'reports', `${agentId}.json`), report);
}

export function loadQualityReport(agentId: string): QualityReport | null {
  return readJsonSafe<QualityReport | null>(path.join(ROOT_DATA_DIR, 'reports', `${agentId}.json`), null);
}

export function saveTrustLedger(agentId: string, entries: TrustLedgerEntry[]) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'trust_ledger', `${agentId}.json`), entries);
}

export function loadTrustLedger(agentId: string): TrustLedgerEntry[] {
  return readJsonSafe<TrustLedgerEntry[]>(path.join(ROOT_DATA_DIR, 'trust_ledger', `${agentId}.json`), []);
}

export function appendTrustLedgerEntry(agentId: string, entry: TrustLedgerEntry) {
  const existing = loadTrustLedger(agentId);
  saveTrustLedger(agentId, [entry, ...existing].slice(0, 100));
}

export function saveRegressionResult(agentId: string, result: RegressionResult) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'regressions', `${agentId}.json`), result);
}

export function loadRegressionResult(agentId: string): RegressionResult | null {
  return readJsonSafe<RegressionResult | null>(
    path.join(ROOT_DATA_DIR, 'regressions', `${agentId}.json`),
    null
  );
}

export function saveBaselineComparison(agentId: string, comparison: HumanBaselineComparison) {
  writeJsonSafe(path.join(ROOT_DATA_DIR, 'baselines', `${agentId}.json`), comparison);
}

export function loadBaselineComparison(agentId: string): HumanBaselineComparison | null {
  return readJsonSafe<HumanBaselineComparison | null>(
    path.join(ROOT_DATA_DIR, 'baselines', `${agentId}.json`),
    null
  );
}

export function listAllAgentIds(): string[] {
  ensureDataDirectories();
  const dir = path.join(ROOT_DATA_DIR, 'generated_agents');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function loadWorkspaceBundle(agentId: string): AgentWorkspaceBundle | null {
  const agent = loadAgentDefinition(agentId);
  if (!agent) return null;
  const requirements = loadRequirements(agentId);
  const groundability = loadGroundability(agentId);
  if (!requirements || !groundability) return null;

  const documents = loadDocumentsMetadata(agentId);
  const chunks = loadChunks(agentId);
  const eval_cases = loadEvalDataset(agentId);
  const eval_results = loadEvalResults(agentId);
  const optimization_logs = loadOptimizationLogs(agentId);
  const quality_report = loadQualityReport(agentId);
  const trust_ledger = loadTrustLedger(agentId);
  const regression_result = loadRegressionResult(agentId);
  const baseline_comparison = loadBaselineComparison(agentId);

  return {
    agent,
    requirements,
    groundability,
    documents,
    chunks_count: chunks.length,
    eval_cases,
    eval_results,
    optimization_logs,
    quality_report,
    trust_ledger,
    regression_result,
    baseline_comparison,
  };
}

export function listAllWorkspaceBundles(): AgentWorkspaceBundle[] {
  const ids = listAllAgentIds();
  const bundles: AgentWorkspaceBundle[] = [];
  for (const id of ids) {
    const b = loadWorkspaceBundle(id);
    if (b) bundles.push(b);
  }
  bundles.sort((a, b) => b.agent.updated_at.localeCompare(a.agent.updated_at));
  return bundles;
}

export function deleteAgentWorkspace(agentId: string) {
  const pathsToRemove = [
    path.join(ROOT_DATA_DIR, 'generated_agents', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'requirements', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'groundability', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'uploads', `${agentId}_docs.json`),
    path.join(ROOT_DATA_DIR, 'vectorstores', `${agentId}_chunks.json`),
    path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_dataset.json`),
    path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_results.json`),
    path.join(ROOT_DATA_DIR, 'evaluations', `${agentId}_opt_logs.json`),
    path.join(ROOT_DATA_DIR, 'reports', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'trust_ledger', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'regressions', `${agentId}.json`),
    path.join(ROOT_DATA_DIR, 'baselines', `${agentId}.json`),
  ];
  for (const p of pathsToRemove) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const uploadDir = path.join(ROOT_DATA_DIR, 'uploads', agentId);
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

export function computeDashboardMetrics(selectedAgentId?: string): DashboardMetrics {
  const bundles = listAllWorkspaceBundles();
  const total_agents = bundles.length;
  const documents_processed = bundles.reduce(
    (s, b) => s + b.documents.filter((d) => d.status === 'processed').length,
    0
  );
  const total_chunks = bundles.reduce((s, b) => s + b.chunks_count, 0);

  let evaluation_cases_executed = 0;
  let successful_evaluations = 0;
  let failed_evaluations = 0;
  let optimization_iterations = 0;
  const scores: number[] = [];

  for (const b of bundles) {
    evaluation_cases_executed += b.eval_results.length;
    successful_evaluations += b.eval_results.filter((r) => r.passed).length;
    failed_evaluations += b.eval_results.filter((r) => !r.passed).length;
    optimization_iterations += b.optimization_logs.length;
    if (b.quality_report) {
      scores.push(b.quality_report.overall_score);
    }
  }

  const average_quality_score =
    scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 0;

  const active =
    (selectedAgentId ? bundles.find((b) => b.agent.id === selectedAgentId) : bundles[0]) ?? null;

  return {
    total_agents,
    documents_processed,
    total_chunks,
    evaluation_cases_executed,
    average_quality_score,
    successful_evaluations,
    failed_evaluations,
    optimization_iterations,
    active_agent_status: active ? `${active.agent.agent_name} (${active.agent.status})` : 'No agent active',
  };
}
