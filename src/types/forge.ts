export type ToolId = 'csv_lookup' | 'calculator' | 'public_weather' | 'current_date';

export type GroundabilityStatus =
  | 'Fully supported'
  | 'Partially supported'
  | 'Not supported'
  | 'Conflicting information';

export type EvalCategory = 'answerable' | 'out_of_scope' | 'edge_case';

export type FailureCategory =
  | 'none'
  | 'retrieval_miss'
  | 'prompt_defect'
  | 'hallucination'
  | 'wrong_refusal'
  | 'incorrect_citation'
  | 'incomplete_answer';

export type TrustStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface DocumentFile {
  id: string;
  agent_id: string;
  filename: string;
  file_type: 'pdf' | 'docx' | 'txt' | 'csv';
  size_bytes: number;
  sha256: string;
  page_or_row_count: number;
  chunk_count: number;
  is_demo?: boolean;
  uploaded_at: string;
  status: 'processed' | 'error' | 'duplicate_skipped';
  error_message?: string;
  preview_text: string;
  prompt_injection_flags?: string[];
}

export interface DocumentChunk {
  chunk_id: string;
  agent_id: string;
  document_name: string;
  file_type: 'pdf' | 'docx' | 'txt' | 'csv';
  page_or_row: string;
  source_text: string;
  char_count: number;
  embedding?: number[];
  injection_sanitized?: boolean;
}

export interface RetrievedChunk {
  chunk_id: string;
  document_name: string;
  page_or_row: string;
  source_text: string;
  similarity_score: number;
}

export interface ClarificationTurn {
  question: string;
  answer: string;
}

export interface RequirementsSpec {
  agent_id: string;
  original_brief: string;
  additional_requirements?: string;
  agent_name: string;
  agent_purpose: string;
  scope: string;
  target_audience: string;
  tone: string;
  must_answer_topics: string[];
  must_refuse_topics: string[];
  supported_topics: string[];
  unsupported_topics: string[];
  required_tools: ToolId[];
  limitations: string[];
  clarification_history: ClarificationTurn[];
  approved: boolean;
  created_at: string;
}

export interface GroundabilityTopicCheck {
  topic: string;
  status: GroundabilityStatus;
  evidence: string[];
  source_documents: string[];
  explanation: string;
}

export interface GroundabilityReport {
  agent_id: string;
  overall_groundability_pct: number;
  checks: GroundabilityTopicCheck[];
  flagged_gaps: string[];
  warnings: string[];
  generated_at: string;
}

export interface RetrievalConfig {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  similarity_threshold: number;
}

export interface AgentDefinition {
  id: string;
  agent_name: string;
  description: string;
  system_prompt: string;
  target_audience: string;
  tone: string;
  supported_topics: string[];
  refusal_rules: string[];
  retrieval_config: RetrievalConfig;
  selected_tools: ToolId[];
  output_contract: string;
  source_citation_requirements: string;
  known_limitations: string[];
  version: number;
  status: 'draft' | 'evaluating' | 'optimizing' | 'ready' | 'baseline_human';
  is_demo?: boolean;
  created_at: string;
  updated_at: string;
}

export interface EvalTestCase {
  test_id: string;
  question: string;
  category: EvalCategory;
  subcategory: string;
  expected_behavior: string;
  expected_facts: string[];
  expected_source_documents: string[];
  expected_refusal: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface EvalCaseScores {
  grounding: number;
  correctness: number;
  refusal_accuracy: number;
  citation_accuracy: number;
  relevance: number;
  overall: number;
}

export interface EvalCaseResult {
  test_id: string;
  question: string;
  category: EvalCategory;
  expected_refusal: boolean;
  expected_facts: string[];
  expected_source_documents: string[];
  agent_response: string;
  retrieved_evidence: RetrievedChunk[];
  scores: EvalCaseScores;
  passed: boolean;
  failure_category: FailureCategory;
  failure_explanation: string;
  tool_calls_used: string[];
  contradictions_detected?: string[];
  deterministic_penalties?: string[];
}

export interface TargetedChange {
  target: 'system_prompt' | 'retrieval_config' | 'refusal_rules' | 'citation_rules';
  parameter_or_section: string;
  previous_value: string;
  new_value: string;
  reason: string;
  failure_category: FailureCategory;
}

export interface OptimizationIteration {
  iteration: number;
  previous_score: number;
  new_score: number;
  failures_identified: number;
  failure_breakdown: Record<string, number>;
  exact_changes: TargetedChange[];
  test_cases_addressed: string[];
  resolved_count: number;
  newly_broken_cases?: string[];
  rolled_back?: boolean;
  notes: string;
  timestamp: string;
}

export interface PromptCandidateResult {
  candidate_id: string;
  label: string;
  strategy: string;
  sample_score: number;
  grounding_score: number;
  refusal_accuracy: number;
  selected: boolean;
}

export interface BudgetMetrics {
  total_llm_calls: number;
  total_embedding_calls: number;
  total_latency_ms: number;
  avg_latency_ms?: number;
  estimated_tokens: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  early_stopped: boolean;
  stop_reason?: string;
}

export interface PipelineIntegrityAudit {
  ghost_citations_caught: number;
  ungrounded_numbers_caught: number;
  contradictions_caught?: number;
  injection_flags_detected?: number;
  tool_hygiene_passed: boolean;
  tool_hygiene_note: string;
  flagged_details: Array<{
    test_id: string;
    issue_type: 'ghost_citation' | 'ungrounded_number' | 'contradiction';
    detail: string;
  }>;
}

export interface BaselineHeadToHeadItem {
  test_id: string;
  question: string;
  category: EvalCategory;
  factory_score: number;
  human_score: number;
  reason: string;
}

export interface HumanBaselineComparison {
  agent_id: string;
  human_baseline_name: string;
  human_system_prompt: string;
  human_score: number;
  factory_score: number;
  factory_wins: BaselineHeadToHeadItem[];
  human_wins: BaselineHeadToHeadItem[];
  ties: number;
  summary: string;
  compared_at: string;
}

export interface QualityReport {
  agent_id: string;
  agent_name: string;
  total_cases: number;
  correct_answers: number;
  incorrect_answers: number;
  correct_refusals: number;
  incorrect_refusals: number;
  grounding_score: number;
  correctness_score: number;
  citation_accuracy: number;
  refusal_accuracy: number;
  relevance_score: number;
  overall_score: number;
  iterations: OptimizationIteration[];
  remaining_failures: EvalCaseResult[];
  known_limitations: string[];
  recommended_improvements: string[];
  prompt_tournament?: PromptCandidateResult[];
  pipeline_integrity?: PipelineIntegrityAudit;
  budget_metrics: BudgetMetrics;
  generated_at: string;
}

export interface ToolExecutionLog {
  tool: ToolId;
  arguments: Record<string, unknown>;
  result_summary: string;
}

export interface TrustLedgerEntry {
  id: string;
  agent_id: string;
  timestamp: string;
  question: string;
  answer: string;
  supporting_documents: string[];
  supporting_locations: string[];
  retrieved_evidence: RetrievedChunk[];
  evidence_relevance: number;
  grounding_status: TrustStatus;
  confidence_score?: number;
  calibration_reason?: string;
  unsupported_claims: string[];
  deterministic_checks?: {
    ghost_citations: string[];
    ungrounded_numbers: string[];
    contradictions?: string[];
  };
  tool_executions: ToolExecutionLog[];
  latency_ms: number;
}

export interface RegressionResult {
  agent_id: string;
  run_at: string;
  previous_score: number;
  new_score: number;
  total_cases: number;
  regressions: {
    test_id: string;
    question: string;
    previous_passed: boolean;
    new_passed: boolean;
    previous_score: number;
    new_score: number;
    reason: string;
  }[];
  improvements: number;
  unchanged: number;
}

export interface AgentVersionSnapshot {
  version: number;
  created_at: string;
  reason: string;
  score?: number;
  agent: AgentDefinition;
}

export interface AgentWorkspaceBundle {
  agent: AgentDefinition;
  requirements: RequirementsSpec;
  groundability: GroundabilityReport;
  documents: DocumentFile[];
  chunks_count: number;
  eval_cases: EvalTestCase[];
  eval_results: EvalCaseResult[];
  optimization_logs: OptimizationIteration[];
  quality_report: QualityReport | null;
  trust_ledger: TrustLedgerEntry[];
  regression_result?: RegressionResult | null;
  baseline_comparison?: HumanBaselineComparison | null;
  versions?: AgentVersionSnapshot[];
}

export interface DashboardMetrics {
  total_agents: number;
  documents_processed: number;
  total_chunks: number;
  evaluation_cases_executed: number;
  average_quality_score: number;
  successful_evaluations: number;
  failed_evaluations: number;
  optimization_iterations: number;
  active_agent_status: string;
}
