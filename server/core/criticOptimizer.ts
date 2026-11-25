import { Type } from '@google/genai';
import type {
  AgentDefinition,
  DocumentChunk,
  DocumentFile,
  EvalCaseResult,
  EvalTestCase,
  OptimizationIteration,
  PipelineIntegrityAudit,
  PromptCandidateResult,
  QualityReport,
  RequirementsSpec,
  TargetedChange,
} from '../../src/types/forge.ts';
import { generatePromptTournamentCandidates } from './agentGenerator.ts';
import { BudgetTracker, generateStructuredJson, loadPromptTemplate } from './gemini.ts';
import { evaluateAgentOnSuite } from './judge.ts';
import type { CsvTableSource } from './tools.ts';
import { detectGhostCitations, detectUngroundedNumbers } from './trustLedger.ts';

export function computeOverallScore(results: EvalCaseResult[]): number {
  if (results.length === 0) return 0;
  const passedCount = results.filter((r) => r.passed).length;
  return Number(((passedCount / results.length) * 100).toFixed(1));
}

export function buildPipelineIntegrityAudit(
  agent: AgentDefinition,
  results: EvalCaseResult[],
  documents?: DocumentFile[]
): PipelineIntegrityAudit {
  let ghost_citations_caught = 0;
  let ungrounded_numbers_caught = 0;
  let contradictions_caught = 0;
  const flagged_details: PipelineIntegrityAudit['flagged_details'] = [];

  for (const r of results) {
    const ghosts = detectGhostCitations(r.agent_response, r.retrieved_evidence);
    for (const g of ghosts) {
      ghost_citations_caught += 1;
      flagged_details.push({ test_id: r.test_id, issue_type: 'ghost_citation', detail: g });
    }
    const toolLogs = r.tool_calls_used.map((t) => ({
      tool: t as AgentDefinition['selected_tools'][number],
      arguments: {},
      result_summary: r.agent_response,
    }));
    const ungrounded = detectUngroundedNumbers(r.agent_response, r.retrieved_evidence, toolLogs);
    if (ungrounded.length > 0 && !r.expected_refusal) {
      ungrounded_numbers_caught += ungrounded.length;
      flagged_details.push({
        test_id: r.test_id,
        issue_type: 'ungrounded_number',
        detail: `Values not verbatim in retrieved text: ${ungrounded.join(', ')}`,
      });
    }
    if (r.contradictions_detected && r.contradictions_detected.length > 0) {
      contradictions_caught += r.contradictions_detected.length;
      for (const c of r.contradictions_detected) {
        flagged_details.push({
          test_id: r.test_id,
          issue_type: 'contradiction',
          detail: c,
        });
      }
    }
  }

  const injection_flags_detected = (documents ?? []).reduce(
    (sum, d) => sum + (d.prompt_injection_flags?.length ?? 0),
    0
  );

  const descLower = `${agent.description} ${agent.supported_topics.join(' ')}`.toLowerCase();
  const weatherMisattached =
    agent.selected_tools.includes('public_weather') &&
    !/\b(weather|forecast|temperature|port condition|wind)\b/.test(descLower);

  return {
    ghost_citations_caught,
    ungrounded_numbers_caught,
    contradictions_caught,
    injection_flags_detected,
    tool_hygiene_passed: !weatherMisattached,
    tool_hygiene_note: weatherMisattached
      ? 'Warning: public_weather tool attached without weather intent in agent scope.'
      : `Clean (${agent.selected_tools.length} tool(s) attached matching scope).`,
    flagged_details: flagged_details.slice(0, 12),
  };
}

export function buildQualityReport(params: {
  agent: AgentDefinition;
  results: EvalCaseResult[];
  iterations: OptimizationIteration[];
  tracker: BudgetTracker;
  promptTournament?: PromptCandidateResult[];
  documents?: DocumentFile[];
}): QualityReport {
  const total = params.results.length || 1;
  const answerable = params.results.filter((r) => !r.expected_refusal);
  const refusals = params.results.filter((r) => r.expected_refusal);

  const correct_answers = answerable.filter((r) => r.passed).length;
  const incorrect_answers = answerable.length - correct_answers;
  const correct_refusals = refusals.filter((r) => r.passed).length;
  const incorrect_refusals = refusals.length - correct_refusals;

  const avg = (fn: (r: EvalCaseResult) => number) =>
    Number(((params.results.reduce((s, r) => s + fn(r), 0) / total) * 100).toFixed(1));

  const remaining_failures = params.results.filter((r) => !r.passed);
  const overall_score = computeOverallScore(params.results);

  const recommended_improvements: string[] = [];
  if (remaining_failures.some((f) => f.failure_category === 'retrieval_miss')) {
    recommended_improvements.push(
      'Increase chunk overlap or add structured section headers to policy documents to prevent retrieval misses.'
    );
  }
  if (remaining_failures.some((f) => f.failure_category === 'incorrect_citation')) {
    recommended_improvements.push(
      'Enforce explicit post-processing citation verification against chunk IDs before emitting final response.'
    );
  }
  if (remaining_failures.some((f) => f.failure_category === 'wrong_refusal')) {
    recommended_improvements.push(
      'Expand document corpus to cover partially supported edge policies or clarify out-of-scope refusal boundaries.'
    );
  }
  if (remaining_failures.length === 0) {
    recommended_improvements.push(
      'Expand evaluation suite with newly arriving edge queries and monitor regression metrics when documents update.'
    );
  }

  const pipeline_integrity = buildPipelineIntegrityAudit(
    params.agent,
    params.results,
    params.documents
  );

  return {
    agent_id: params.agent.id,
    agent_name: params.agent.agent_name,
    total_cases: params.results.length,
    correct_answers,
    incorrect_answers,
    correct_refusals,
    incorrect_refusals,
    grounding_score: avg((r) => r.scores.grounding),
    correctness_score: avg((r) => r.scores.correctness),
    citation_accuracy: avg((r) => r.scores.citation_accuracy),
    refusal_accuracy: avg((r) => r.scores.refusal_accuracy),
    relevance_score: avg((r) => r.scores.relevance),
    overall_score,
    iterations: params.iterations,
    remaining_failures,
    known_limitations: params.agent.known_limitations,
    recommended_improvements,
    prompt_tournament: params.promptTournament,
    pipeline_integrity,
    budget_metrics: params.tracker.toJSON(),
    generated_at: new Date().toISOString(),
  };
}

export async function runPromptTournament(params: {
  baseAgent: AgentDefinition;
  requirements: RequirementsSpec;
  testCases: EvalTestCase[];
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  tracker: BudgetTracker;
}): Promise<{ bestAgent: AgentDefinition; tournamentResults: PromptCandidateResult[] }> {
  const candidates = await generatePromptTournamentCandidates({
    baseAgent: params.baseAgent,
    requirements: params.requirements,
    tracker: params.tracker,
  });

  // Use a balanced 6-case diagnostic slice (2 answerable, 2 out_of_scope, 2 edge_case)
  const sampleCases = [
    ...params.testCases.filter((c) => c.category === 'answerable').slice(0, 2),
    ...params.testCases.filter((c) => c.category === 'out_of_scope').slice(0, 2),
    ...params.testCases.filter((c) => c.category === 'edge_case').slice(0, 2),
  ];

  const tournamentResults: PromptCandidateResult[] = [];
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const candAgent: AgentDefinition = {
      ...params.baseAgent,
      system_prompt: cand.system_prompt,
    };
    const res = await evaluateAgentOnSuite({
      agent: candAgent,
      testCases: sampleCases,
      chunks: params.chunks,
      csvSources: params.csvSources,
      tracker: params.tracker,
    });
    const score = computeOverallScore(res);
    const groundingAvg = Number(
      ((res.reduce((s, r) => s + r.scores.grounding, 0) / Math.max(1, res.length)) * 100).toFixed(1)
    );
    const refusalAvg = Number(
      ((res.reduce((s, r) => s + r.scores.refusal_accuracy, 0) / Math.max(1, res.length)) * 100).toFixed(1)
    );

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }

    tournamentResults.push({
      candidate_id: cand.candidate_id,
      label: cand.label,
      strategy: cand.strategy,
      sample_score: score,
      grounding_score: groundingAvg,
      refusal_accuracy: refusalAvg,
      selected: false,
    });
  }

  if (tournamentResults[bestIdx]) {
    tournamentResults[bestIdx].selected = true;
  }

  const winningPrompt = candidates[bestIdx]?.system_prompt ?? params.baseAgent.system_prompt;
  return {
    bestAgent: {
      ...params.baseAgent,
      system_prompt: winningPrompt,
    },
    tournamentResults,
  };
}

export function evaluateOptimizationStepOutcome(
  prevResults: EvalCaseResult[],
  nextResults: EvalCaseResult[]
): {
  previous_score: number;
  new_score: number;
  resolved_count: number;
  newly_broken_cases: string[];
  should_accept: boolean;
  reason: string;
} {
  const previous_score = computeOverallScore(prevResults);
  const new_score = computeOverallScore(nextResults);
  const prevMap = new Map(prevResults.map((r) => [r.test_id, r]));

  let resolved_count = 0;
  const newly_broken_cases: string[] = [];

  for (const nr of nextResults) {
    const pr = prevMap.get(nr.test_id);
    if (!pr) continue;
    if (!pr.passed && nr.passed) {
      resolved_count += 1;
    } else if (pr.passed && !nr.passed) {
      newly_broken_cases.push(nr.test_id);
    }
  }

  const prevMeanRubric =
    prevResults.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, prevResults.length);
  const nextMeanRubric =
    nextResults.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, nextResults.length);

  let should_accept = false;
  let reason = '';

  if (new_score > previous_score && newly_broken_cases.length <= resolved_count) {
    should_accept = true;
    reason = `Accepted: pass rate increased (${previous_score}% -> ${new_score}%), ${resolved_count} resolved, ${newly_broken_cases.length} regression(s).`;
  } else if (
    new_score === previous_score &&
    newly_broken_cases.length === 0 &&
    nextMeanRubric > prevMeanRubric + 0.005
  ) {
    should_accept = true;
    reason = `Accepted: pass rate held at ${new_score}% with 0 regressions and higher rubric quality (${(
      prevMeanRubric * 100
    ).toFixed(1)}% -> ${(nextMeanRubric * 100).toFixed(1)}%).`;
  } else {
    should_accept = false;
    reason =
      new_score < previous_score
        ? `Rolled back: score regressed (${previous_score}% -> ${new_score}%).`
        : newly_broken_cases.length > 0
        ? `Rolled back: patch introduced ${newly_broken_cases.length} regression(s) (${newly_broken_cases.join(
            ', '
          )}) without net improvement.`
        : `Rolled back: no measurable quality improvement over baseline (${previous_score}%).`;
  }

  return {
    previous_score,
    new_score,
    resolved_count,
    newly_broken_cases,
    should_accept,
    reason,
  };
}

export async function runCriticOptimizerLoop(params: {
  agent: AgentDefinition;
  testCases: EvalTestCase[];
  chunks: DocumentChunk[];
  csvSources: CsvTableSource[];
  tracker: BudgetTracker;
  maxIterations?: number;
  maxTokenBudget?: number;
  onProgress?: (message: string) => void;
  onVersionSnapshot?: (agent: AgentDefinition, reason: string, score?: number) => void;
}): Promise<{
  finalAgent: AgentDefinition;
  finalResults: EvalCaseResult[];
  iterations: OptimizationIteration[];
}> {
  const maxIter = Math.min(3, params.maxIterations ?? 3);
  const tokenBudget = params.maxTokenBudget ?? 180000;
  const criticSystem = loadPromptTemplate('critic_prompt.txt');

  let currentAgent: AgentDefinition = JSON.parse(JSON.stringify(params.agent));
  params.onProgress?.('Running baseline evaluation (Iteration 1)...');
  let currentResults = await evaluateAgentOnSuite({
    agent: currentAgent,
    testCases: params.testCases,
    chunks: params.chunks,
    csvSources: params.csvSources,
    tracker: params.tracker,
  });
  let currentScore = computeOverallScore(currentResults);
  params.onVersionSnapshot?.(currentAgent, 'Baseline evaluation before optimization', currentScore);

  const iterations: OptimizationIteration[] = [];

  for (let iter = 1; iter <= maxIter; iter++) {
    const failed = currentResults.filter((r) => !r.passed);
    const breakdown: Record<string, number> = {};
    for (const f of failed) {
      breakdown[f.failure_category] = (breakdown[f.failure_category] ?? 0) + 1;
    }

    if (failed.length === 0) {
      iterations.push({
        iteration: iter,
        previous_score: currentScore,
        new_score: currentScore,
        failures_identified: 0,
        failure_breakdown: {},
        exact_changes: [],
        test_cases_addressed: [],
        resolved_count: 0,
        notes: 'All evaluation cases passed; no targeted fixes required.',
        timestamp: new Date().toISOString(),
      });
      break;
    }

    if (params.tracker.estimated_tokens > tokenBudget) {
      params.tracker.early_stopped = true;
      params.tracker.stop_reason = `Token budget (${tokenBudget}) reached before iteration ${iter}.`;
      break;
    }

    params.onProgress?.(
      `Iteration ${iter}: Diagnosing ${failed.length} failed cases (baseline ${currentScore}%)...`
    );

    // Ask Critic for targeted surgical changes only
    const criticPlan = await generateStructuredJson<{
      diagnosis_summary: string;
      retrieval_adjustments: {
        adjust_top_k_delta: number;
        adjust_threshold_delta: number;
        reason: string;
      };
      prompt_patch_append: string;
      refusal_rule_addition: string;
      citation_rule_refinement: string;
      addressed_test_ids: string[];
    }>({
      systemInstruction: criticSystem,
      tracker: params.tracker,
      lowThinking: true,
      prompt: `
Current Agent Retrieval Config: ${JSON.stringify(currentAgent.retrieval_config)}
Current Citation Requirement: ${currentAgent.source_citation_requirements}
Current Refusal Rules: ${JSON.stringify(currentAgent.refusal_rules)}

Failed Evaluation Cases (${failed.length} of ${currentResults.length}):
${failed
  .slice(0, 10)
  .map(
    (f) =>
      `- ${f.test_id} [${f.failure_category}]: Q="${f.question}" | ExpectedRefusal=${f.expected_refusal} | Explanation="${f.failure_explanation}"`
  )
  .join('\n')}

Prescribe MINIMAL, TARGETED patches (do not rewrite the entire prompt). Only adjust retrieval parameters if retrieval_miss occurred; only add refusal clarification if wrong_refusal occurred; only add citation formatting reinforcement if incorrect_citation occurred.
`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          diagnosis_summary: { type: Type.STRING },
          retrieval_adjustments: {
            type: Type.OBJECT,
            properties: {
              adjust_top_k_delta: { type: Type.INTEGER },
              adjust_threshold_delta: { type: Type.NUMBER },
              reason: { type: Type.STRING },
            },
            required: ['adjust_top_k_delta', 'adjust_threshold_delta', 'reason'],
          },
          prompt_patch_append: { type: Type.STRING },
          refusal_rule_addition: { type: Type.STRING },
          citation_rule_refinement: { type: Type.STRING },
          addressed_test_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'diagnosis_summary',
          'retrieval_adjustments',
          'prompt_patch_append',
          'refusal_rule_addition',
          'citation_rule_refinement',
          'addressed_test_ids',
        ],
      },
    });

    const exact_changes: TargetedChange[] = [];
    const candidateAgent: AgentDefinition = JSON.parse(JSON.stringify(currentAgent));

    // Apply targeted retrieval adjustments if warranted
    if (
      (breakdown['retrieval_miss'] || breakdown['incomplete_answer']) &&
      (criticPlan.retrieval_adjustments.adjust_top_k_delta !== 0 ||
        criticPlan.retrieval_adjustments.adjust_threshold_delta !== 0)
    ) {
      const prevCfg = { ...candidateAgent.retrieval_config };
      const newTopK = Math.max(
        3,
        Math.min(10, prevCfg.top_k + (criticPlan.retrieval_adjustments.adjust_top_k_delta || 1))
      );
      const newThresh = Number(
        Math.max(
          0.1,
          Math.min(0.45, prevCfg.similarity_threshold + (criticPlan.retrieval_adjustments.adjust_threshold_delta || -0.04))
        ).toFixed(2)
      );
      if (newTopK !== prevCfg.top_k || newThresh !== prevCfg.similarity_threshold) {
        candidateAgent.retrieval_config.top_k = newTopK;
        candidateAgent.retrieval_config.similarity_threshold = newThresh;
        exact_changes.push({
          target: 'retrieval_config',
          parameter_or_section: 'top_k / similarity_threshold',
          previous_value: `top_k=${prevCfg.top_k}, threshold=${prevCfg.similarity_threshold}`,
          new_value: `top_k=${newTopK}, threshold=${newThresh}`,
          reason: criticPlan.retrieval_adjustments.reason || 'Mitigate retrieval misses on multi-section queries.',
          failure_category: breakdown['retrieval_miss'] ? 'retrieval_miss' : 'incomplete_answer',
        });
      }
    }

    // Apply targeted refusal rule if wrong_refusal occurred
    if (breakdown['wrong_refusal'] && criticPlan.refusal_rule_addition.trim().length > 5) {
      const rule = criticPlan.refusal_rule_addition.trim();
      candidateAgent.refusal_rules.push(rule);
      exact_changes.push({
        target: 'refusal_rules',
        parameter_or_section: 'refusal_rules[]',
        previous_value: `${currentAgent.refusal_rules.length} rules`,
        new_value: `Added: "${rule}"`,
        reason: 'Clarify answerable vs out-of-scope refusal boundaries.',
        failure_category: 'wrong_refusal',
      });
    }

    // Apply targeted citation rule if incorrect_citation occurred
    if (breakdown['incorrect_citation'] && criticPlan.citation_rule_refinement.trim().length > 5) {
      const prevCite = candidateAgent.source_citation_requirements;
      candidateAgent.source_citation_requirements = `${prevCite} ${criticPlan.citation_rule_refinement.trim()}`;
      exact_changes.push({
        target: 'citation_rules',
        parameter_or_section: 'source_citation_requirements',
        previous_value: prevCite.slice(0, 120),
        new_value: candidateAgent.source_citation_requirements.slice(0, 160),
        reason: 'Enforce exact [DocumentName, Page/Row] inline citation format.',
        failure_category: 'incorrect_citation',
      });
    }

    // Apply surgical prompt addendum
    if (criticPlan.prompt_patch_append.trim().length > 5) {
      const patch = criticPlan.prompt_patch_append.trim();
      candidateAgent.system_prompt = `${candidateAgent.system_prompt}\n\n[Targeted Optimization Patch #${iter}]\n${patch}`;
      exact_changes.push({
        target: 'system_prompt',
        parameter_or_section: `Optimization Patch #${iter}`,
        previous_value: 'Base system instructions',
        new_value: patch,
        reason: criticPlan.diagnosis_summary,
        failure_category: (Object.keys(breakdown)[0] as EvalCaseResult['failure_category']) || 'prompt_defect',
      });
    }

    if (exact_changes.length === 0) {
      iterations.push({
        iteration: iter,
        previous_score: currentScore,
        new_score: currentScore,
        failures_identified: failed.length,
        failure_breakdown: breakdown,
        exact_changes: [],
        test_cases_addressed: [],
        resolved_count: 0,
        notes: 'Critic found no safe targeted mutation that improves coverage without risking regressions.',
        timestamp: new Date().toISOString(),
      });
      break;
    }

    params.onProgress?.(`Iteration ${iter}: Re-evaluating ${params.testCases.length} cases after targeted patch...`);
    const nextResults = await evaluateAgentOnSuite({
      agent: candidateAgent,
      testCases: params.testCases,
      chunks: params.chunks,
      csvSources: params.csvSources,
      tracker: params.tracker,
    });
    const outcome = evaluateOptimizationStepOutcome(currentResults, nextResults);

    iterations.push({
      iteration: iter,
      previous_score: outcome.previous_score,
      new_score: outcome.new_score,
      failures_identified: failed.length,
      failure_breakdown: breakdown,
      exact_changes,
      test_cases_addressed: criticPlan.addressed_test_ids ?? failed.map((f) => f.test_id),
      resolved_count: outcome.resolved_count,
      newly_broken_cases: outcome.newly_broken_cases,
      rolled_back: !outcome.should_accept,
      notes: `${criticPlan.diagnosis_summary} | ${outcome.reason}`,
      timestamp: new Date().toISOString(),
    });

    if (outcome.should_accept) {
      currentAgent = {
        ...candidateAgent,
        version: currentAgent.version + 1,
        updated_at: new Date().toISOString(),
      };
      currentResults = nextResults;
      currentScore = outcome.new_score;
      params.onVersionSnapshot?.(
        currentAgent,
        `Optimization Iteration ${iter}: ${outcome.reason}`,
        currentScore
      );
    } else {
      params.tracker.early_stopped = true;
      params.tracker.stop_reason = outcome.reason;
      break;
    }

    if (currentScore >= 95 || nextResults.every((r) => r.passed)) {
      break;
    }
  }

  currentAgent.status = 'ready';
  currentAgent.updated_at = new Date().toISOString();

  return {
    finalAgent: currentAgent,
    finalResults: currentResults,
    iterations,
  };
}
