import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOptimizationStepOutcome } from '../server/core/criticOptimizer.ts';
import { BudgetTracker } from '../server/core/gemini.ts';
import {
  deleteAgentWorkspace,
  loadAgentDefinition,
  loadAgentVersions,
  rollbackAgentToVersion,
  saveAgentDefinition,
  saveAgentVersionSnapshot,
} from '../server/core/storage.ts';
import type { AgentDefinition, EvalCaseResult } from '../src/types/forge.ts';

function makeResult(id: string, passed: boolean, overall: number): EvalCaseResult {
  return {
    test_id: id,
    question: `Question ${id}`,
    category: 'answerable',
    expected_refusal: false,
    expected_facts: ['fact'],
    expected_source_documents: ['doc.txt'],
    agent_response: 'response',
    retrieved_evidence: [],
    scores: {
      grounding: overall,
      correctness: overall,
      refusal_accuracy: 1,
      citation_accuracy: overall,
      relevance: overall,
      overall,
    },
    passed,
    failure_category: passed ? 'none' : 'incomplete_answer',
    failure_explanation: passed ? 'ok' : 'missed fact',
    tool_calls_used: [],
  };
}

test('evaluateOptimizationStepOutcome accepts strict gains and rolls back on regressions', () => {
  const prev = [makeResult('E1', true, 0.9), makeResult('E2', false, 0.4), makeResult('E3', false, 0.4)];
  const improved = [makeResult('E1', true, 0.92), makeResult('E2', true, 0.88), makeResult('E3', false, 0.4)];
  const regressed = [makeResult('E1', false, 0.5), makeResult('E2', false, 0.4), makeResult('E3', false, 0.4)];
  const churnedSameScore = [makeResult('E1', false, 0.5), makeResult('E2', true, 0.85), makeResult('E3', false, 0.4)];

  const okOutcome = evaluateOptimizationStepOutcome(prev, improved);
  assert.equal(okOutcome.should_accept, true);
  assert.equal(okOutcome.resolved_count, 1);
  assert.deepEqual(okOutcome.newly_broken_cases, []);

  const dropOutcome = evaluateOptimizationStepOutcome(prev, regressed);
  assert.equal(dropOutcome.should_accept, false);
  assert.deepEqual(dropOutcome.newly_broken_cases, ['E1']);

  const churnOutcome = evaluateOptimizationStepOutcome(prev, churnedSameScore);
  assert.equal(churnOutcome.should_accept, false);
  assert.deepEqual(churnOutcome.newly_broken_cases, ['E1']);
});

test('Agent versioning saves snapshots and restores prior version cleanly', () => {
  const testId = 'test_version_agent_tmp';
  try {
    const base: AgentDefinition = {
      id: testId,
      agent_name: 'Versioned Test Agent',
      description: 'Test agent',
      system_prompt: 'Prompt v1',
      target_audience: 'Staff',
      tone: 'Concise',
      supported_topics: ['Leave'],
      refusal_rules: ['Refuse out of scope'],
      retrieval_config: { chunk_size: 700, chunk_overlap: 120, top_k: 4, similarity_threshold: 0.2 },
      selected_tools: [],
      output_contract: 'Cite inline',
      source_citation_requirements: '[Doc, Section]',
      known_limitations: [],
      version: 1,
      status: 'ready',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    saveAgentDefinition(base);
    saveAgentVersionSnapshot(base, 'Initial baseline', 75);

    const v2: AgentDefinition = { ...base, version: 2, system_prompt: 'Prompt v2' };
    saveAgentDefinition(v2);
    saveAgentVersionSnapshot(v2, 'Optimization iter 1', 88);

    const versions = loadAgentVersions(testId);
    assert.equal(versions.length, 2);

    const restored = rollbackAgentToVersion(testId, 1);
    assert.ok(restored);
    assert.equal(restored!.version, 1);
    assert.equal(restored!.system_prompt, 'Prompt v1');

    const loaded = loadAgentDefinition(testId);
    assert.equal(loaded?.version, 1);
    assert.equal(loaded?.system_prompt, 'Prompt v1');
  } finally {
    deleteAgentWorkspace(testId);
  }
});

test('BudgetTracker computes actual usageMetadata tokens and estimated USD cost', () => {
  const tracker = new BudgetTracker();
  tracker.recordLlm(1000, 200, 420, {
    promptTokenCount: 2500,
    candidatesTokenCount: 500,
    totalTokenCount: 3000,
  });
  tracker.recordEmbedding(800, 120, 200);

  const metrics = tracker.toJSON();
  assert.equal(metrics.total_llm_calls, 1);
  assert.equal(metrics.total_embedding_calls, 1);
  assert.equal(metrics.estimated_tokens, 3200);
  assert.equal(metrics.input_tokens, 2700);
  assert.equal(metrics.output_tokens, 500);
  assert.equal(metrics.avg_latency_ms, 270);
  assert.ok(metrics.estimated_cost_usd > 0);
});
