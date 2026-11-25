import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjudicateEvalCase,
  computeDeterministicCitationMatch,
  computeDeterministicFactMatch,
} from '../server/core/judge.ts';
import type { EvalTestCase, RetrievedChunk } from '../src/types/forge.ts';

test('computeDeterministicFactMatch normalizes dates/currency and enforces numeric boundaries', () => {
  const resExact = computeDeterministicFactMatch(
    'Shore staff may carry over up to 5 days and must use them by Mar 31; meal allowance is 35 USD.',
    ['5 days', 'March 31', '$35']
  );
  assert.equal(resExact.matched, 3);
  assert.equal(resExact.entity_ratio, 1);

  // "15 days" MUST NOT match expected fact "5 days"
  const resBoundaryFalse = computeDeterministicFactMatch(
    'Shore staff may carry over up to 15 days into Q1.',
    ['5 days']
  );
  assert.equal(resBoundaryFalse.matched, 0);
  assert.ok(resBoundaryFalse.missed_entities.includes('5'));
});

test('adjudicateEvalCase blocks false-positive passes on contradictions and ungrounded numbers', () => {
  const tc: EvalTestCase = {
    test_id: 'EVAL-CONTRADICT',
    question: 'Can I cash out my unused sick leave days?',
    category: 'edge_case',
    subcategory: 'false_premise',
    expected_behavior: 'Explain that unused sick leave is not encashable.',
    expected_facts: ['not encashable', 'does not carry over'],
    expected_source_documents: ['HR_Leave_Policy_2026.txt'],
    expected_refusal: false,
    difficulty: 'medium',
  };

  const evidence: RetrievedChunk[] = [
    {
      chunk_id: 'HR_Leave_Policy_2026.txt::chunk_1',
      document_name: 'HR_Leave_Policy_2026.txt',
      page_or_row: 'Section 2',
      source_text: 'Unused sick leave is not encashable and does not carry over.',
      similarity_score: 0.85,
    },
  ];

  // Even if an LLM judge mistakenly returned passed=true, deterministic contradiction check must reject it
  const contradicted = adjudicateEvalCase({
    tc,
    answer: 'Yes, unused sick leave is encashable at year end [HR_Leave_Policy_2026.txt, Section 2].',
    retrieved_evidence: evidence,
    tool_calls_used: [],
    llmEval: {
      grounding: 0.9,
      correctness: 0.85,
      refusal_accuracy: 1,
      citation_accuracy: 0.9,
      relevance: 0.9,
      passed: true,
      failure_category: 'none',
      failure_explanation: '',
    },
  });

  assert.equal(contradicted.passed, false);
  assert.equal(contradicted.failure_category, 'hallucination');
  assert.ok((contradicted.contradictions_detected?.length ?? 0) > 0);
  assert.ok(contradicted.scores.grounding <= 0.25);

  // Genuine accurate answer passes cleanly
  const valid = adjudicateEvalCase({
    tc,
    answer: 'No, unused sick leave is not encashable and does not carry over [HR_Leave_Policy_2026.txt, Section 2].',
    retrieved_evidence: evidence,
    tool_calls_used: [],
    llmEval: {
      grounding: 0.95,
      correctness: 0.95,
      refusal_accuracy: 1,
      citation_accuracy: 0.95,
      relevance: 0.95,
      passed: true,
      failure_category: 'none',
      failure_explanation: '',
    },
  });
  assert.equal(valid.passed, true);
  assert.equal(valid.failure_category, 'none');
});

test('adjudicateEvalCase blocks ghost citations and partial misleading answers with wrong numbers', () => {
  const tc: EvalTestCase = {
    test_id: 'EVAL-PARTIAL',
    question: 'What is the domestic hotel cap and expense deadline?',
    category: 'answerable',
    subcategory: 'multi_section',
    expected_behavior: '$190/night hotel cap and 14 calendar days submission deadline.',
    expected_facts: ['$190', '14 calendar days'],
    expected_source_documents: ['Workplace_Code_of_Conduct.txt'],
    expected_refusal: false,
    difficulty: 'medium',
  };

  const evidence: RetrievedChunk[] = [
    {
      chunk_id: 'Workplace_Code_of_Conduct.txt::chunk_2',
      document_name: 'Workplace_Code_of_Conduct.txt',
      page_or_row: 'Section 2',
      source_text: 'Overnight domestic hotel reimbursement is capped at $190 USD per night. Expense claims must be submitted within 14 calendar days.',
      similarity_score: 0.82,
    },
  ];

  const wrongNumbers = adjudicateEvalCase({
    tc,
    answer: 'Hotel cap is $250 per night and claims must be submitted within 30 calendar days [Fake_Doc.txt, Section 1].',
    retrieved_evidence: evidence,
    tool_calls_used: [],
    llmEval: {
      grounding: 0.8,
      correctness: 0.8,
      refusal_accuracy: 1,
      citation_accuracy: 0.8,
      relevance: 0.9,
      passed: true,
    },
  });

  assert.equal(wrongNumbers.passed, false);
  assert.ok((wrongNumbers.deterministic_penalties?.length ?? 0) > 0);
  assert.ok(wrongNumbers.scores.citation_accuracy <= 0.45);
});

test('computeDeterministicCitationMatch rewards bracketed matching docs', () => {
  const good = computeDeterministicCitationMatch(
    'Approved leave requires 5 working days notice [HR_Leave_Policy_2026.txt, Section 1].',
    ['HR_Leave_Policy_2026.txt']
  );
  assert.equal(good.hasBracketCitation, true);
  assert.equal(good.score, 1);
});
